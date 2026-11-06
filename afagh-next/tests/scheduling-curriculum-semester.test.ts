/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «فاز ۱ (گام ۱) برای رشتهٔ ۴۴ / ترم ۳ خالی نماند»
 *
 *  گزارش کاربر (مدیرگروه برق، کد ۴۰۲۵۰۱):
 *    «رشتهٔ ۴۴ (مهندسی حرفه‌ای برق قدرت) و ترم ۳ را انتخاب کردم برای
 *     برنامه‌ریزی، اما در فاز ۱ هیچ درسی نشان نداد.»
 *    ⇒ تب «گام ۱: چارت دروس و انتساب اساتید» با نشان «۰ درس» و جدول خالی.
 *
 *  دو ایرادِ مستقل که با هم این خالی‌بودن را می‌ساختند:
 *
 *  ① سمت سرور — `listCurriculumDemands` ترمِ چارت را از زوج/فردِ
 *     `academic_terms."sortOrder"` حدس می‌زد:
 *        sortOrder=14051 ⇒ ((14051-1)%2)+1 = 1  ⇒ همیشه «ترم ۱»!
 *     دروس ترم ۳ (۹ درس / ۱۴ ارائه در ترم ۱۴۰۵۱) هرگز به کلاینت نمی‌رسید.
 *
 *  ② شکلِ داده — همان تابع `semesterNo` و `programIds` را برنمی‌گرداند؛
 *     `mapDemands` پس `semesterNo = null` می‌کرد و فیلترِ کلاینت
 *     (`filterContextDemands`) با شرط `d.semesterNo === 3` همهٔ ردیف‌ها را
 *     حذف می‌کرد ⇒ صفر ردیف.
 *
 *  این تست هر دو را قفل می‌کند: گاردِ منبع (رفتار واقعیِ فایل‌ها) + رفتارِ
 *  تابعِ خالصِ `chartScopeSemester` که هر دو سمت (سرور و کلاینت) از آن
 *  استفاده می‌کنند.
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartScopeSemester, filterContextDemands, cohortSemesterNo } from '../src/app/admin/scheduling/planning-core.ts';
import type { CourseDemand } from '../src/app/admin/scheduling/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src', 'app', 'admin', 'scheduling');
const ACTIONS_SRC = readFileSync(path.join(SRC, 'actions.ts'), 'utf8');
const PROVIDER_SRC = readFileSync(path.join(SRC, 'PlanningProvider.tsx'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m}`); }
};
const eq = (name: string, got: unknown, want: unknown): void => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

console.log('\n▶ گارد سرور: ترمِ چارت از دامنهٔ کاربر می‌آید، نه از حدسِ زوج/فرد');
{
  ok(
    !ACTIONS_SRC.includes('((term.sortOrder - 1) % 2) + 1'),
    'heuristic زوج/فردِ sortOrder حذف شده است',
  );
  ok(
    !ACTIONS_SRC.includes('currentSemester'),
    'متغیرِ currentSemester (حدسِ سرور) دیگر وجود ندارد',
  );
  ok(
    /listCurriculumDemands\([\s\S]{0,400}?semester\?: number \| 'ALL' \| 'NONE' \| null/.test(ACTIONS_SRC),
    'listCurriculumDemands پارامترِ semester را می‌گیرد',
  );
  ok(
    ACTIONS_SRC.includes("eq(curriculum_courses.recommendedSemester, semester)"),
    'فیلترِ چارت روی recommendedSemester اعمال می‌شود',
  );
  ok(
    ACTIONS_SRC.includes("semesterNo: semesterByCourse.get(r.courseId) ?? null"),
    'semesterNo از ترمِ چارتِ همان درس خوانده می‌شود',
  );
  ok(
    ACTIONS_SRC.includes('programIds: [programId]'),
    'programIds رشتهٔ چارت برگردانده می‌شود (فیلترِ رشته کار می‌کند)',
  );
  ok(
    /getCurriculumDemandsAction\([\s\S]{0,300}?semester\?: number \| 'ALL' \| 'NONE' \| null/.test(ACTIONS_SRC),
    'getCurriculumDemandsAction پارامترِ semester را می‌گیرد',
  );
}

console.log('\n▶ گارد کلاینت: ترمِ انتخابی به سرور فرستاده و جدول خالی نمی‌ماند');
{
  ok(
    PROVIDER_SRC.includes('getCurriculumDemandsAction(selectedTermId, selectedProgramId, entryYear, chartSemester)'),
    'ترمِ چارتی به اکشنِ سرور فرستاده می‌شود',
  );
  ok(
    PROVIDER_SRC.includes('chartScopeSemester('),
    'ترم از تابعِ خالصِ chartScopeSemester گرفته می‌شود',
  );
  ok(
    /useEffect\(\(\) => \{\s*loadCurriculumDemands\(\);[\s\S]{0,200}?\}, \[selectedTermId, selectedProgramId, selectedCohortId, selectedSemester\]\)/.test(PROVIDER_SRC),
    'با تغییرِ ترمِ چارت (چیپ فاز ۰) داده دوباره بارگذاری می‌شود',
  );
  ok(
    PROVIDER_SRC.includes('filterContextDemands(courseDemands, ctx)'),
    'شبکهٔ ایمنی: اگر مسیرِ چارت چیزی نداد، ارائه‌های واقعیِ ترم نشان داده می‌شود',
  );
}

console.log('\n▶ رفتارِ تابعِ خالص: ترمِ دامنه');
{
  eq('بدون ورودی ⇒ چیپِ فاز ۰ (ترم ۳)',
    chartScopeSemester({ cohortId: 'ALL', entryYear: null, entryTerm: null, termCode: '14051', selectedSemester: 3 }), 3);
  eq('بدون ورودی ⇒ ALL',
    chartScopeSemester({ cohortId: 'ALL', entryYear: null, entryTerm: null, termCode: '14051', selectedSemester: 'ALL' }), 'ALL');
  eq('بدون ورودی ⇒ NONE',
    chartScopeSemester({ cohortId: 'ALL', entryYear: null, entryTerm: null, termCode: '14051', selectedSemester: 'NONE' }), 'NONE');
  // ورودی ۱۴۰۴-۱ در ترم ۱۴۰۵۱ ⇒ ترمِ ۳ چارت
  eq('ورودی ۱۴۰۴-۱ در ۱۴۰۵۱ ⇒ ترم ۳',
    chartScopeSemester({ cohortId: '1404-1', entryYear: 1404, entryTerm: 1, termCode: '14051', selectedSemester: 'ALL' }), 3);
  // اولویت با ورودی است، نه با چیپ
  eq('ورودی بر چیپ اولویت دارد',
    chartScopeSemester({ cohortId: '1404-1', entryYear: 1404, entryTerm: 1, termCode: '14051', selectedSemester: 1 }), 3);
  // ورودیِ خیلی قدیمی ⇒ ترمِ بالا (چارتِ ۴ ترمه ⇒ بی‌عرضه، ولی عدد درست)
  eq('ورودی ۱۴۰۱-۱ در ۱۴۰۵۱ ⇒ ترم ۹',
    chartScopeSemester({ cohortId: '1401-1', entryYear: 1401, entryTerm: 1, termCode: '14051', selectedSemester: 'ALL' }), 9);
  // کد ترمِ نامعتبر ⇒ برمی‌گردد به چیپ
  eq('کد ترمِ نامعتبر ⇒ برمی‌گردد به چیپ',
    chartScopeSemester({ cohortId: '1404-1', entryYear: 1404, entryTerm: 1, termCode: null, selectedSemester: 2 }), 2);
  eq('سالِ ورودیِ نامعتبر ⇒ برمی‌گردد به چیپ',
    chartScopeSemester({ cohortId: 'x-1', entryYear: null, entryTerm: null, termCode: '14051', selectedSemester: 4 }), 4);
  eq('پایه: cohortSemesterNo', cohortSemesterNo(1404, 1, '14051'), 3);
}

console.log('\n▶ بازتولیدِ باگ: جدولِ گام ۱ با payloadِ قدیم خالی می‌شد');
{
  const base = {
    id: 1, courseId: 10, courseDeptId: 77, programId: 133, programTitle: 'برق قدرت',
    code: '44107', title: 'نرم افزارهاي تخصصي قدرت2', units: 3, groupNumber: 1,
    courseType: 'تخصصي', capacity: 40, enrolledCount: 12, preferredProfId: 0,
    groupsCount: 1, weekRecurrence: 'ALL', sessionsCountPerWeek: 1, examDate: '',
    requiredRoomType: 'THEORY', courseTypeRank: 3,
  } as unknown as CourseDemand;

  // ① payloadِ قدیمیِ سرور: نه semesterNo داشت، نه programIds
  const oldPayload = [
    { ...base, id: 1, programIds: [], semesterNo: null },
    { ...base, id: 2, programIds: [], semesterNo: null },
  ] as CourseDemand[];
  eq('payloadِ قدیمی ⇒ صفر ردیف (همان باگِ گزارش‌شده)',
    filterContextDemands(oldPayload, { programId: 133, cohortId: 'ALL', semester: 3 }).length, 0);

  // ② payloadِ جدید: semesterNo و programIds از چارت می‌آید
  const newPayload = [
    { ...base, id: 1, programIds: [133], semesterNo: 3 },
    { ...base, id: 2, programIds: [133], semesterNo: 3 },
    { ...base, id: 3, programIds: [133], semesterNo: 1 },
  ] as CourseDemand[];
  eq('payloadِ جدید ⇒ فقط دروسِ ترم ۳',
    filterContextDemands(newPayload, { programId: 133, cohortId: 'ALL', semester: 3 }).map(d => d.id), [1, 2]);
  eq('payloadِ جدید ⇒ «همهٔ ترم‌ها» همه را می‌آورد',
    filterContextDemands(newPayload, { programId: 133, cohortId: 'ALL', semester: 'ALL' }).map(d => d.id), [1, 2, 3]);
  eq('رشتهٔ دیگر دروسِ این رشته را نمی‌بیند',
    filterContextDemands(newPayload, { programId: 188, cohortId: 'ALL', semester: 'ALL' }).length, 0);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} scheduling-curriculum-semester: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
