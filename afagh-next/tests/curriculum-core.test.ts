/**
 * تست واحد هستهٔ خالص ماژول برنامهٔ درسی — بدون React، بدون DB، بدون DOM
 *
 * اجرا: npm test
 * این توابع تا این دور داخل کامپوننت ۱۸۳۱ سطری CurriculumManagerClient بودند
 * (و هیچ تستی نداشتند). حالا در src/app/admin/curriculum/curriculum-core.ts‌اند:
 *   faNum / faDate / STATUS_UI / ROLE_LABELS / TABS / resolveTab
 *   buildRuleTree / leafCourseCodesOf / leafTotalOf / validateMinGrade
 *   groupBySemester / semesterUnitTotal / overflowSemesters / termGrid / isOverflowSemester / semLabel
 *   typeSummaryRows / unitsByRoleMap
 *   facultyNames / departmentNames / filterMajorsByTree / filterBankCourses / visibleBank / allBankSelected
 */
import {
  allBankSelected, BANK_VISIBLE_LIMIT, buildRuleTree, CURRICULUM_TABS, departmentNames, dependencyWarningText,
  dependencyWarnings, dependencyWarningsMap, EXTRA_ROLE_LABELS, faDate,
  faNum, facultyNames, filterBankCourses, filterMajorsByTree, groupBySemester, isOverflowSemester,
  leafCourseCodesOf, leafTotalOf, overflowSemesters, resolveTab, roleLabel, ROLE_LABELS, ROLE_TARGET_KEYS, semLabel,
  semesterUnitTotal, STATUS_UI, TABS, termGrid, typeSummaryRows, unitsByRoleMap, validateMinGrade,
  visibleBank,
} from '../src/app/admin/curriculum/curriculum-core.ts';
import { SUMMER_SEMESTER, planSemesters } from '../src/lib/term-plan.ts';

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

/** سازندهٔ ردیف درس نسخه */
type Seed = { code?: string; units?: number; role?: string; sem?: number | null };
const C = (o: Seed) => ({
  courseId: 1, code: o.code ?? 'C1', title: 'درس', units: o.units ?? 3, roleType: o.role ?? 'CORE',
  isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 'sem' in o ? o.sem ?? null : 1,
  minGrade: null, passGradeStatusCode: null, failGradeStatusCode: null,
});

console.log('۱) رقم و تاریخ فارسی');
eq('null → خط تیره', faNum(null), '—');
eq('undefined → خط تیره', faNum(undefined), '—');
eq('رشتهٔ خالی → خط تیره', faNum(''), '—');
eq('رقم‌های داخل متن تبدیل می‌شوند', faNum('R12'), 'R۱۲');
eq('صفر تبدیل می‌شود نه خط تیره', faNum(0), '۰');
eq('رشتهٔ بدون رقم دست‌نخورده', faNum('ABC'), 'ABC');
eq('تاریخ null → خط تیره', faDate(null), '—');
eq('رشتهٔ بی‌ربط عیناً برمی‌گردد', faDate('نامشخص'), 'نامشخص');
eq('تاریخ معتبر ارقام فارسی دارد (بدون لاتین)', /[۰-۹]/.test(faDate('2025-01-15')) && !/\d/.test(faDate('2025-01-15')), true);
eq('شیء Date هم پذیرفته می‌شود', /[۰-۹]/.test(faDate(new Date('2025-01-15T00:00:00Z'))), true);
eq('رشتهٔ تاریخ بدون سال نامعتبر → عیناً', faDate('2025-13-45'), '2025-13-45');

console.log('۲) ثابت‌های نمایشی');
eq('پنج وضعیت چرخهٔ حیات', Object.keys(STATUS_UI), ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']);
eq('برچسب فارسی منتشرشده', STATUS_UI.PUBLISHED.label, 'منتشرشده');
eq('وضعیت ناشناخته در STATUS_UI نیست (فایل رندرکننده fallback دارد)', STATUS_UI.NOPE === undefined, true);
// از کامیت f83f070 «تخصصی» نقش مستقل SPECIALIZED گرفت و از «اصلی» جدا شد ⇒ هشت نقش؛
// مهاجرت ۰۱۲۹ «جبرانی» (COMPENSATORY) را به نقش‌های رسمی افزود ⇒ نه نقش.
eq('نه نقش درس (شامل جبرانی)، به همان ترتیب', Object.keys(ROLE_LABELS), ['CORE', 'MAJOR', 'SPECIALIZED', 'ELECTIVE', 'GENERAL', 'THESIS', 'INTERNSHIP', 'WORKSHOP', 'COMPENSATORY']);
eq('پنج تب', TABS.map(t => t.key), ['CATALOG', 'COURSES', 'SEMESTERS', 'VERIFY', 'TRANSFER']);
eq('CURRICULUM_TABS از TABS مشتق می‌شود', CURRICULUM_TABS, TABS.map(t => t.key));

console.log('۳) resolveTab — پیوند ?tab= امن');
eq('CATALOG', resolveTab('CATALOG'), 'CATALOG');
eq('VERIFY', resolveTab('VERIFY'), 'VERIFY');
eq('null → تب اول', resolveTab(null), 'CATALOG');
eq('خالی → تب اول', resolveTab(''), 'CATALOG');
eq('مقدار نامعتبر → تب اول', resolveTab('DROP TABLE'), 'CATALOG');
eq('بزرگ/کوچک حساس است', resolveTab('catalog'), 'CATALOG');
eq('همهٔ تب‌های مشروع برگردانده می‌شوند', CURRICULUM_TABS.map(resolveTab), [...CURRICULUM_TABS]);

console.log('۴) درخت قاعده (پیش‌نیاز/هم‌نیاز)');
eq('لیست خالی → بدون قاعده', buildRuleTree([], 'AND'), null);
eq('تک‌شرط', buildRuleTree(['A'], 'AND'), { operator: 'AND', conditions: [{ course: 'A' }] });
eq('OR حفظ می‌شود', buildRuleTree(['A', 'B'], 'OR'), { operator: 'OR', conditions: [{ course: 'A' }, { course: 'B' }] });
eq('برگ‌ها به همان ترتیب', leafCourseCodesOf(buildRuleTree(['B', 'A', 'C'], 'AND') ?? undefined), ['B', 'A', 'C']);
eq('درخت تو در تو: برگ‌ها عمق‌اول جمع می‌شوند', leafCourseCodesOf({
  operator: 'AND',
  conditions: [{ course: 'A' }, { operator: 'OR', conditions: [{ course: 'B' }, { course: 'C' }] }],
} as never), ['A', 'B', 'C']);
eq('شاخهٔ خالی هیچ برگی ندارد', leafCourseCodesOf({ operator: 'AND', conditions: [] } as never), []);
eq('تعریف‌نشده → آرایهٔ خالی', leafCourseCodesOf(undefined), []);
eq('شمارش شرط‌ها (شاخه به اندازهٔ فرزندانش)', leafTotalOf({
  operator: 'AND',
  conditions: [{ course: 'A' }, { operator: 'OR', conditions: [{ course: 'B' }, { course: 'C' }] }],
} as never), 3);
eq('شمارش درخت تو در تو با دو شاخه', leafTotalOf({
  operator: 'AND',
  conditions: [{ operator: 'AND', conditions: [{ course: 'X' }, { course: 'Y' }] }, { course: 'Z' }],
} as never), 3);
eq('تعریف‌نشده → صفر', leafTotalOf(undefined), 0);
eq('تکراری‌ها شمرده می‌شوند', leafTotalOf(buildRuleTree(['A', 'A'], 'AND') as never), 2);
eq('راونگشت: ساخت ← استخراج', leafCourseCodesOf(buildRuleTree(['K', 'L'], 'OR') as never), ['K', 'L']);
eq('کد صفر هم برگ است', leafCourseCodesOf({ operator: 'AND', conditions: [{ course: 0 as unknown as string }] } as never), ['0']);

console.log('۵) validateMinGrade — کف نمرهٔ مودال قاعده');
eq('بدون تغییر → اکشن صدا زده نمی‌شود', validateMinGrade('12', '12'), { changed: false, value: null, error: null });
eq('فاصله‌ها بی‌اثرند', validateMinGrade('  12 ', '12'), { changed: false, value: null, error: null });
eq('پاک‌کردن مقدار → null مجاز است', validateMinGrade('', '12'), { changed: true, value: null, error: null });
eq('مقدار جدید', validateMinGrade('15', '12'), { changed: true, value: 15, error: null });
eq('صفر مجاز است', validateMinGrade('0', '12'), { changed: true, value: 0, error: null });
eq('بیست مجاز است', validateMinGrade('20', ''), { changed: true, value: 20, error: null });
eq('بیست‌ویک رد می‌شود', validateMinGrade('21', '')?.error, 'کف نمره باید بین ۰ تا ۲۰ باشد.');
eq('منفی رد می‌شود', validateMinGrade('-1', '')?.error !== null, true);
eq('متن غیرعددی رد می‌شود', validateMinGrade('ده', '')?.error !== null, true);
eq('undefined ورودی مثل رشتهٔ خالی', validateMinGrade(undefined, ''), { changed: false, value: null, error: null });

console.log('۶) چیدمان چارت ترمی');
const cs = [C({ code: 'a', sem: 1, units: 3 }), C({ code: 'b', sem: 3, units: 2 }), C({ code: 'c', sem: null, units: 1 }), C({ code: 'd', sem: 1, units: 4 })];
const grouped = groupBySemester(cs);
eq('گروه‌بندی بر اساس ترم', [...grouped.bySemester.keys()], [1, 3]);
eq('ردیف‌های بی‌ترم جدا می‌مانند', grouped.unassigned.map(c => c.code), ['c']);
eq('ترتیب درون هر ترم حفظ می‌شود', grouped.bySemester.get(1)!.map(c => c.code), ['a', 'd']);
eq('فهرست خالی', groupBySemester([]), { bySemester: {}, unassigned: [] });
eq('تعریف‌نشده مثل خالی است', groupBySemester(undefined), { bySemester: {}, unassigned: [] });
eq('جمع واحد یک ترم', semesterUnitTotal(grouped.bySemester.get(1)), 7);
eq('جمع واحد همهٔ دروس', semesterUnitTotal(cs), 10);
eq('فهرست تعریف‌نشده → صفر', semesterUnitTotal(undefined), 0);
eq('واحد نامعتبر صفر حساب می‌شود', semesterUnitTotal([{ units: NaN } as never]), 0);
const plan4 = planSemesters(4);
eq('چارت ۴ ترمه', plan4, [1, 2, 3, 4]);
eq('سرریز: ترم‌های ۵ و ۷ مرتب و بدون تابستان', overflowSemesters([1, 5, 7, SUMMER_SEMESTER], plan4), [5, 7]);
eq('بدون سرریز → خالی', overflowSemesters([1, 2, 3, 4], plan4), []);
eq('شبکه = چارت + سرریز + تابستان', termGrid(plan4, [1, 6]), [1, 2, 3, 4, 6, SUMMER_SEMESTER]);
eq('تابستان هرگز در سرریز تکرار نمی‌شود', termGrid(plan4, [SUMMER_SEMESTER]).filter(t => t === SUMMER_SEMESTER).length, 1);
eq('ترم داخل چارت سرریز نیست', isOverflowSemester(2, plan4), false);
eq('تابستان سرریز نیست', isOverflowSemester(SUMMER_SEMESTER, plan4), false);
eq('ترم ۵ در چارت ۴ ترمه سرریز است', isOverflowSemester(5, plan4), true);
eq('برچسب ترم', [semLabel(3), semLabel(SUMMER_SEMESTER), semLabel(null), semLabel(undefined)], ['ترم ۳', 'تابستان', 'نامشخص', 'نامشخص']);

console.log('۷) خلاصهٔ نوع درس و سهم نقش');
const cs2 = [C({ role: 'CORE', units: 3 }), C({ role: 'CORE', units: 2 }), C({ role: 'GENERAL', units: 1 }), C({ role: 'WEIRD', units: 4 })];
eq('جمع و شمارش هر نقش', typeSummaryRows(cs2), [
  { role: 'CORE', count: 2, units: 5 },
  { role: 'GENERAL', count: 1, units: 1 },
  { role: 'WEIRD', count: 1, units: 4 },
]);
eq('نقش ناشناخته آخر می‌نشیند', typeSummaryRows(cs2).at(-1)!.role, 'WEIRD');
eq('بدون درس → فهرست خالی', typeSummaryRows([]), []);
eq('تعریف‌نشده → خالی', typeSummaryRows(undefined), []);
eq('واحد موجود هر نقش', [...unitsByRoleMap(cs2).entries()], [['CORE', 5], ['GENERAL', 1], ['WEIRD', 4]]);
eq('نقشِ بدون درس در نقشه نیست', unitsByRoleMap(cs2).get('THESIS') ?? 'absent', 'absent');

console.log('۸) فیلتر درختی رشته (دانشکده ← گروه ← رشته)');
type M = { id: number; code: string; name: string; degreeLevelId: number | null; degreeTitle: string | null; facultyName?: string; departmentName?: string };
const mm: M[] = [
  { id: 1, code: 'CM', name: 'کامپیوتر', degreeLevelId: 2, degreeTitle: 'کارشناسی', facultyName: 'فنی', departmentName: 'الکتریک' },
  { id: 2, code: 'EE', name: 'برق', degreeLevelId: 2, degreeTitle: 'کارشناسی', facultyName: 'فنی', departmentName: 'الکتریک' },
  { id: 3, code: 'LA', name: 'ادبیات', degreeLevelId: 2, degreeTitle: 'کارشناسی', facultyName: 'ادبیات', departmentName: 'زبان' },
  { id: 4, code: 'XX', name: 'بدون دانشکده', degreeLevelId: null, degreeTitle: null },
] as never;
eq('دانشکده‌ها یکتا و با ترتیب الفبای فارسی', facultyNames(mm as never), ['ادبیات', 'فنی']);
eq('بی‌نام‌ها حذف می‌شوند', facultyNames([{ id: 5 } as never]).length, 0);
eq('گروه‌ها در دانشکدهٔ فنی', departmentNames(mm as never, 'فنی'), ['الکتریک']);
eq('بدون فیلتر دانشکده، همهٔ گروه‌ها', departmentNames(mm as never, ''), ['الکتریک', 'زبان']);
eq('فیلتر دانشکده', filterMajorsByTree(mm as never, 'فنی', '').map(m => m.code), ['CM', 'EE']);
eq('فیلتر دانشکده + گروه', filterMajorsByTree(mm as never, 'فنی', 'الکتریک').map(m => m.id), [1, 2]);
eq('فیلتر بی‌نتیجه → خالی', filterMajorsByTree(mm as never, 'فنی', 'زبان'), []);
eq('فیلتر خالی = همه', filterMajorsByTree(mm as never, '', '').length, 4);

console.log('۹) فیلتر بانک دروس و سقف نمایش');
type B = { id: number; code: string; title: string; units: string; courseType: string };
const bb: B[] = [
  { id: 101, code: 'CM101', title: 'مبانی برنامه‌سازی', units: '3', courseType: 'اصلی' },
  { id: 202, code: 'EE201', title: 'مدارها', units: '2', courseType: 'اصلی' },
  { id: 303, code: 'CM305', title: 'کامپایلر', units: '3', courseType: 'اختیاری' },
];
eq('جستجو در عنوان', filterBankCourses(bb, 'کامپایلر', '').map(c => c.id), [303]);
eq('جستجو در کد', filterBankCourses(bb, 'CM', '').map(c => c.id), [101, 303]);
eq('جستجو در شناسه', filterBankCourses(bb, '202', '').map(c => c.id), [202]);
eq('پیشوند کد رشته', filterBankCourses(bb, '', 'CM').map(c => c.id), [101, 303]);
eq('ترکیب جستجو + پیشوند', filterBankCourses(bb, 'مبانی', 'CM').map(c => c.id), [101]);
eq('ترکیب ناسازگار → خالی', filterBankCourses(bb, 'مدارها', 'CM'), []);
eq('فیلتر خالی = همه', filterBankCourses(bb, '', '').length, 3);
eq('فاصله‌های اضافه نادیده گرفته می‌شوند', filterBankCourses(bb, '  کامپایلر  ', '  ').map(c => c.id), [303]);
const many: B[] = Array.from({ length: 137 }, (_, i) => ({ id: i, code: `X${i}`, title: `درس ${i}`, units: '2', courseType: 'اصلی' }));
eq('سقف ردیف‌های مودال', BANK_VISIBLE_LIMIT, 60);
eq('فقط ۶۰ ردیف اول رندر می‌شود', visibleBank(many).length, 60);
eq('همه انتخاب نشده‌اند', allBankSelected(bb, new Set([101])), false);
eq('همه انتخاب شده‌اند', allBankSelected(bb, new Set([101, 202, 303])), true);
eq('فیلتر خالی → «همه انتخاب شده» نه', allBankSelected([], new Set()), false);
eq('انتخاب‌های خارج از فیلتر مزاحم نیستند', allBankSelected([bb[0]], new Set([101, 202])), true);

console.log('۱۰) هشدار پیش‌نیاز/هم‌نیاز در چارت');
const dc = (id: number, code: string, sem: number | null) => ({
  courseId: id, code, title: code, units: 3, roleType: 'CORE',
  isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: sem,
  minGrade: null, passGradeStatusCode: null, failGradeStatusCode: null,
});
const dRule = (id: number, type: string, codes: string[]) => ({ courseId: id, ruleType: type, logicTree: buildRuleTree(codes, 'AND')! });
const w1 = dependencyWarnings([dc(1, 'A', 2), dc(2, 'B', null)], [dRule(1, 'PREREQ', ['B'])]);
eq('پیش‌نیاز بی‌ترم → unassigned', w1.length === 1 && w1[0].unassigned.includes('B') && !w1[0].impossibleTerm, true);
const w2 = dependencyWarnings([dc(1, 'A', 3)], [dRule(1, 'PREREQ', ['Z'])]);
eq('پیش‌نیاز ناموجود → missing', w2[0].missing.includes('Z'), true);
const w3 = dependencyWarnings([dc(1, 'A', 1), dc(2, 'B', 2)], [dRule(1, 'PREREQ', ['B'])]);
eq('ترم ۱ با پیش‌نیاز → impossibleTerm', w3[0].impossibleTerm, true);
const w4 = dependencyWarnings([dc(1, 'A', 3), dc(2, 'B', 5)], [dRule(1, 'PREREQ', ['B'])]);
eq('پیش‌نیاز در ترم دیرتر → badOrder', w4[0].badOrder.includes('B'), true);
const w5 = dependencyWarnings([dc(1, 'A', 3), dc(2, 'B', 1)], [dRule(1, 'PREREQ', ['B'])]);
eq('پیش‌نیاز در ترم زودتر → بدون هشدار', w5.length, 0);
const w6 = dependencyWarnings([dc(1, 'A', 2), dc(2, 'B', 2)], [dRule(1, 'COREQ', ['B'])]);
eq('هم‌نیاز هم‌ترم → بدون هشدار', w6.length, 0);
const w7 = dependencyWarnings([dc(1, 'A', 4), dc(2, 'B', 2)], [dRule(1, 'COREQ', ['B'])]);
eq('هم‌نیاز در ترم زودتر (یا هم‌ترم) → بدون هشدار', w7.length, 0);
const w8 = dependencyWarnings([dc(1, 'A', 3), dc(2, 'B', 5)], [dRule(1, 'COREQ', ['B'])]);
eq('هم‌نیاز در ترم بعدتر → badOrder', w8.length === 1 && w8[0].badOrder.includes('B'), true);
eq('متن هشدار هم‌نیاز بعدتر شامل «هم‌نیاز»', dependencyWarningText(w8[0]).includes('هم‌نیاز'), true);
const wm = dependencyWarningsMap([dc(1, 'A', 1), dc(2, 'B', 2)], [dRule(1, 'PREREQ', ['B'])]);
eq('نگاشت بر اساس courseId', wm.get(1)?.length, 1);
eq('متن هشدار شامل «ترم ۱»', dependencyWarningText(w3[0]).includes('ترم ۱'), true);

console.log('\n۱۱) انواع درسِ «سهم واحد» — جبرانی و انواعِ خارج از enum');
eq('برچسب نقش شناخته‌شده', roleLabel('GENERAL'), 'عمومی');
eq('جبرانی برچسب فارسی دارد', roleLabel('COMPENSATORY'), 'جبرانی');
eq('کلید ناشناخته بدون تغییر برمی‌گردد', roleLabel('CUSTOM_TYPE'), 'CUSTOM_TYPE');
eq('جبرانی در فهرست انواعِ سهم واحد هست', ROLE_TARGET_KEYS.includes('COMPENSATORY'), true);
eq('فهرست انواع = نقش‌های چارت + انواعِ خارجی (اکنون صفر)', ROLE_TARGET_KEYS.length, Object.keys(ROLE_LABELS).length + Object.keys(EXTRA_ROLE_LABELS).length);
// مهاجرت ۰۱۲۹: جبرانی اکنون نقشِ رسمیِ نهمِ چارت است (CHECK دیتابیس ۹ مقدار
// را می‌پذیرد)؛ پس در ROLE_LABELS هست و از EXTRA_ROLE_LABELS خارج شد.
eq('جبرانی اکنون نقش رسمیِ چارت است (مهاجرت ۰۱۲۹)', 'COMPENSATORY' in ROLE_LABELS, true);
eq('EXTRA_ROLE_LABELS اکنون خالی است (جبرانی به نقش‌های چارت رفت)', Object.keys(EXTRA_ROLE_LABELS).join(','), '');

const dcRole = (id: number, code: string, role: string, units = 3) => ({
  courseId: id, code, title: code, units, roleType: role,
  isRequired: 1, isElective: 0, isGraduationRequired: 0, recommendedSemester: 1,
  minGrade: null, passGradeStatusCode: null, failGradeStatusCode: null,
});
const sumC = typeSummaryRows([dcRole(1, 'G1', 'GENERAL'), dcRole(2, 'C1', 'COMPENSATORY', 2)]);
eq('نوع جبرانی در جمع‌بندی می‌آید', sumC.some(r => r.role === 'COMPENSATORY' && r.units === 2), true);
eq('جبرانی بعد از نقش‌های چارت مرتب می‌شود', sumC[sumC.length - 1].role, 'COMPENSATORY');
// رشتهٔ بدون درس عمومی: هیچ ردیف GENERAL ساخته نمی‌شود (نه صفرِ ساختگی)
const sumNoGen = typeSummaryRows([dcRole(1, 'M1', 'MAJOR')]);
eq('رشتهٔ بدون عمومی → ردیف عمومی ندارد', sumNoGen.some(r => r.role === 'GENERAL'), false);

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
