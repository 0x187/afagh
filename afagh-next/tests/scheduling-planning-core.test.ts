/**
 * تست واحد هستهٔ خالص کارتابل برنامه‌ریزی درسی — بدون React و بدون DB
 *
 * اجرا: npm test
 * پوشش: این توابع تا دور قبل داخل یک کامپوننت ۲۳۵۸ سطری بودند و هیچ تستی
 * نداشتند. حالا در src/app/admin/scheduling/planning-core.ts نشسته‌اند:
 *   faNum / faToEnDigits / parseJalaliDates (رقوم و تاریخ جلالی از متن آزاد)
 *   mapDemands / mapOfferings / mapCohorts (نگاشت ردیف سرور → مدل UI)
 *   computeProfUnits (بار واحد استاد + تقسیم سهم درس مشترک)
 *   slotAvailStatus (پوشش بازهٔ اعلامی استاد روی یک اسلات)
 *   filterScenarioOfferings / filterContextDemands (فیلتر زمینهٔ صفحه)
 *   inspectorSummary / nextGroupNumber / coTeachingWeights / buildRealScenario
 */
import {
  buildRealScenario, clampGroupsCount, coTeachingWeights, computeProfUnits, courseTypeRank, DAY_NAMES, faNum, faToEnDigits,
  filterContextDemands, filterScenarioOfferings, inspectorSummary, mapCohorts, mapDemands,
  mapOfferings, MAX_GROUPS_PER_COURSE, nextGroupNumber, NO_PROFESSOR, parseJalaliDates, PHASE_LABELS,
  slotAvailStatus, TIME_SLOT_PRESETS, PLANNING_TABS, resolveTab, cohortSemesterNo, chartScopeSemester, suggestGroupsCount,
} from '../src/app/admin/scheduling/planning-core.ts';
import type { CourseDemand, DepartmentOffering, SchedulingWorkspace } from '../src/app/admin/scheduling/types.ts';

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

console.log('۱) رقم فارسی و استخراج تاریخ جلالی');
eq('عدد → فارسی', faNum(1234), '۱۲۳۴');
eq('null → خط تیره', faNum(null), '—');
eq('undefined → خط تیره', faNum(undefined), '—');
eq('صفر حفظ می‌شود (نه falsy!)', faNum(0), '۰');
eq('داخل رشته هم تبدیل می‌شود', faNum('term 12'), 'term ۱۲');
eq('فارسی → لاتین', faToEnDigits('۱۴۰۵/۰۷/۰۱'), '1405/07/01');
eq('عربی (هندی-عربی) → لاتین', faToEnDigits('١٤٠٥'), '1405');
eq('تاریک‌های لاتین از متن آزاد', parseJalaliDates('تعطیل 1405/07/01 و 1405/07/29'), ['1405/07/01', '1405/07/29']);
eq('رقم فارسی + ممیز عربی + فاصله', parseJalaliDates('  ۱۴۰۵٫۰۷٫۰۱  '), ['1405/07/01']);
eq('رقم فارسی با اسلش', parseJalaliDates('تعطیل: ۱۴۰۵/۰۷/۲۹'), ['1405/07/29']);
eq('مخلوط لاتین/فارسی در یک متن', parseJalaliDates('1405/07/01 و ۱۴۰۵/۰۷/۰۲'), ['1405/07/01', '1405/07/02']);
eq('تاریک کوتاه‌شدهٔ سال‌دار فقط', parseJalaliDates('07/01'), []);
eq('بدون تاریخ → آرایهٔ خالی', parseJalaliDates('جمعه تعطیل است'), []);
eq('ماه/روز یک‌رقمی هم قبول', parseJalaliDates('1405/7/1'), ['1405/7/1']);

console.log('\n۲) نگاشت ردیف سرور → مدل UI');
const rawDemand: any = {
  offeringId: 7, courseId: 11, courseDeptId: 3, code: '101', title: 'ریاضی', units: '3.00',
  courseType: 'اصلی', capacity: 40, groupNumber: 2, professorId: 5, isCoTaught: false,
  coProfId: null,
  enrolledCount: 30, programId: 2, programTitle: 'کامپیوتر', cohortId: '1403', cohortTitle: 'ورودی ۱۴۰۳',
  programIds: [],
  semesterNo: null,
  cohortMerged: false,
  examDate: '',
  isSharedService: false,
  offeringScope: 'DEPARTMENTAL',
};
const [d] = mapDemands([rawDemand] as any);
eq('واحد رشته‌ای → عدد', d.units, 3);
eq('واحد نامعتبر → صفر', mapDemands([{ ...rawDemand, units: '—', isSharedService: false, offeringScope: 'DEPARTMENTAL' }])[0].units, 0);
// ⚠️ قرارداد عوض شد: نوع درس دیگر به فهرست بستهٔ ۵ مقدارهای «فارسی» محدود
// نمی‌شود (دادهٔ واقعی با «ی/ک عربی» ذخیره شده و دامنه‌اش باز است). مقدار
// واقعی حفظ و فقط یکسان‌سازی می‌شود — پیش‌تر هر چیزی که در فهرست نبود
// «عمومی» می‌شد و همهٔ درس‌ها عمومی دیده می‌شدند.
eq('نوع درس ناشناخته حفظ می‌شود (نه عمومی)', mapDemands([{ ...rawDemand, courseType: 'آزاد', isSharedService: false, offeringScope: 'DEPARTMENTAL' }])[0].courseType, 'آزاد');
eq('ی/ک عربی → فارسی', mapDemands([{ ...rawDemand, courseType: 'تخصصي', isSharedService: false, offeringScope: 'DEPARTMENTAL' }])[0].courseType, 'تخصصی');
eq('نوع خالی → نامشخص', mapDemands([{ ...rawDemand, courseType: '', isSharedService: false, offeringScope: 'DEPARTMENTAL' }])[0].courseType, 'نامشخص');
eq('رتبهٔ عمومی قبل از تخصصی', [courseTypeRank('عمومي'), courseTypeRank('تخصصي')].sort((a, b) => a - b), [0, 3]);
eq('استاد null → صفر (نه undefined)', mapDemands([{ ...rawDemand, professorId: null, isSharedService: false, offeringScope: 'DEPARTMENTAL' }])[0].preferredProfId, 0);
eq('پیش‌فرض‌های ایمن نشست', [d.requiredRoomType, d.groupsCount, d.weekRecurrence, d.examDate], ['THEORY', 1, 'ALL', '']);
eq('کارت تهی هیچ‌وقت undefined نمی‌شود', NO_PROFESSOR.id, 0);
const [co] = mapCohorts([{ majorId: null, entryYear: 1403, entryTerm: 1, expectedStudents: 120 }]);
// «نیمسال ورود» (مهر/بهمن) به‌جای «سال ورود»
eq('عنوان نیمسال ورود با رقم فارسی', co.title, 'نیمسال ورود مهر ۱۴۰۳');
eq('کلید نیمسال ورود = سال-نیمسال', co.id, '1403-1');
eq('بهمن = نیمسال دوم', mapCohorts([{ majorId: null, entryYear: 1403, entryTerm: 2, expectedStudents: 10 }])[0].title, 'نیمسال ورود بهمن ۱۴۰۳');

const rawApproved = {
  offeringId: 9, code: '202', title: 'فیزیک', units: '2', courseType: 'پایه', groupNumber: 1,
  professorId: 4, professorName: 'دکتر الف', capacity: 35, enrolledCount: 20,
  dayOfWeek: 2, dayName: 'دوشنبه', startTime: '08:00', endTime: '10:00',
  roomId: 6, roomName: 'A1', buildingName: 'پردیس مرکزی',
};
const [off] = mapOfferings([rawApproved]);
eq('روز ۰‌پایه دیتابیس بدون تغییر به UI', off.classSchedules[0].dayOfWeek, 2);
eq('روز null → شنبه (شاخص صفر)', mapOfferings([{ ...rawApproved, dayOfWeek: null }])[0].classSchedules[0].dayOfWeek, 0);
eq('نام سالن و ساختمان حفظ شد', [off.classSchedules[0].roomName, off.classSchedules[0].buildingName], ['A1', 'پردیس مرکزی']);
eq('فیلتر/حوزهٔ کلی برای ورودی‌ها', [off.cohortId, off.programId], ['ALL', 0]);

console.log('\n۳) بار واحد استاد (درس مشترک = تقسیم سهم)');
const base: any = {
  id: 1, courseId: 1, courseDeptId: null, programId: 1, programTitle: 'کامپیوتر', cohortId: 'ALL',
  cohortTitle: 'ورودی ۱۴۰۳', code: 'C1', title: 'درس', units: 3, groupNumber: 1, courseType: 'اصلی',
  preferredProfId: 1, requiredRoomType: 'THEORY', capacity: 40, groupsCount: 1,
  weekRecurrence: 'ALL', sessionsCountPerWeek: 1, examDate: '', enrolledCount: 0,
  isCoTaught: false, coProfId: null, programIds: [], semesterNo: null, cohortMerged: false,
  examMode: 'WRITTEN' as const, examTime: null, examRoomId: null, genderRestriction: 'MIXED' as const,
  isSharedService: false, offeringScope: 'DEPARTMENTAL',
};
const profs: any = [
  { id: 1, name: 'الف', staffCode: '1', academicRank: 'استادیار', contractType: 'تمام‌وقت' as const, departmentId: 1, departmentName: 'گروه', maxWeeklyUnits: 16, maxDailyHours: 6, hasSubmittedAvailability: true },
  { id: 2, name: 'ب', staffCode: '2', academicRank: 'مربی', contractType: 'نیمه‌وقت' as const, departmentId: 1, departmentName: 'گروه', maxWeeklyUnits: 8, maxDailyHours: 4, hasSubmittedAvailability: false },
];
eq('درس تکی × گروه‌های موازی', computeProfUnits([{ ...base, units: 3, groupsCount: 2 }], profs)[1].units, 6);
eq('درس تکی → تعداد گروه‌ها شمرده می‌شود', computeProfUnits([{ ...base, groupsCount: 3 }], profs)[1].coursesCount, 3);
eq('استاد نامعلوم → بدون خطا و بدون کلید جدید', Object.keys(computeProfUnits([{ ...base, preferredProfId: 99 }], profs)).length, 2);
// ۳ واحد × ۷۰٪ = ۲٫۱ برای تئوری و ۳ × ۳۰٪ = ۰٫۹ برای عملی
const coTaught = [{ ...base, isCoTaught: true, coProfId: 2, theoryWeightRatio: 0.7, labWeightRatio: 0.3 }];
eq('سهم تئوری استاد اول', computeProfUnits(coTaught, profs)[1].units, 2.1);
eq('سهم عملی استاد دوم', computeProfUnits(coTaught, profs)[2].units, 0.9);
eq('مجموع سهم = واحد درس (یک‌دهم تلورانس)', Math.round((computeProfUnits(coTaught, profs)[1].units + computeProfUnits(coTaught, profs)[2].units) * 10) / 10, 3);
eq('سهم‌های پیش‌فرض بدون مقدار (۰٫۷/۰٫۳)',
   computeProfUnits([{ ...base, units: 4, isCoTaught: true, coProfId: 2 }], profs)[2].units, 1.2);
eq('مشترک بدون استاد دوم → سهم کامل به استاد اول',
   computeProfUnits([{ ...base, units: 2, isCoTaught: true }], profs)[1].units, 2);

console.log('\n۴) وضعیت درٔ دسترس بودن استاد روی اسلات');
const av = (over: Partial<SchedulingWorkspace['availabilities'][number]> = {}): SchedulingWorkspace['availabilities'][number] => ({
  staffId: 1, dayOfWeek: 0, startTime: '08:00', endTime: '10:00', status: 'PREF', ...over,
});
const SLOT = { startTime: '08:00' };
eq('پوشش کامل با اولویت → PREF', slotAvailStatus([av()], 1, 0, SLOT), 'PREF');
eq('وضعیت AVAIL', slotAvailStatus([av({ status: 'AVAIL' })], 1, 0, SLOT), 'AVAIL');
eq('استاد دیگر → NONE', slotAvailStatus([av({ staffId: 2 })], 1, 0, SLOT), 'NONE');
eq('روز دیگر → NONE (هر دو ۰‌پایه)', slotAvailStatus([av({ dayOfWeek: 1 })], 1, 0, SLOT), 'NONE');
eq('بازهٔ تمام‌شده در شروع اسلات → NONE', slotAvailStatus([av({ startTime: '06:00', endTime: '08:00' })], 1, 0, SLOT), 'NONE');
eq('شروع میانی بازه هم پوشش است', slotAvailStatus([av({ startTime: '07:30', endTime: '09:00' })], 1, 0, SLOT), 'PREF');
eq('PREF بر AVAIL مقدم است', slotAvailStatus([av({ status: 'AVAIL' }), av({ status: 'PREF' })], 1, 0, SLOT), 'PREF');
eq('ردیف بدون ساعت → نادیده', slotAvailStatus([av({ startTime: null, endTime: null })], 1, 0, SLOT), 'NONE');
eq('بدون هیچ ردیف → NONE', slotAvailStatus([], 1, 0, SLOT), 'NONE');

console.log('\n۵) فیلتر زمینهٔ صفحه (رشته / ورودی / نمای هفته)');
const mkOff = (over: Partial<DepartmentOffering> = {}): DepartmentOffering => ({
  id: 1, termId: 0, programId: 0, programTitle: '—', cohortId: 'ALL', cohortTitle: '—', courseId: 1,
  code: 'C1', title: 't', units: 3, courseType: 'اصلی', groupNumber: 1, professorId: 1, professorName: 'x',
  capacity: 40, enrolledCount: 0, waitlistCapacity: 0,
  classSchedules: [{ dayOfWeek: 0, dayName: DAY_NAMES[0], slotId: 1, startTime: '08:00', endTime: '10:00', roomId: 1, roomName: 'r', buildingName: 'b', weekType: 'ALL' }],
  examSchedule: null, courseDeptId: null, offeringId: 1, programIds: [], semesterNo: null, cohortMerged: false,
  examDate: null, examMode: 'WRITTEN', examTime: null, examRoomId: null, isSharedService: false, offeringScope: 'DEPARTMENTAL',
  ...over,
});
const list = [
  mkOff({ id: 1, programId: 0, cohortId: 'ALL' }) as any,                       // عمومی → همیشه
  mkOff({ id: 2, programId: 7, cohortId: 'ALL' }) as any,                        // رشتهٔ ۷
  mkOff({ id: 3, programId: 7, cohortId: '1403' }) as any,                       // رشتهٔ ۷ ورودی ۱۴۰۳
  mkOff({ id: 4, programId: 8, cohortId: 'ALL', classSchedules: [{ ...mkOff().classSchedules[0], weekType: 'EVEN' }] }) as any,
];
eq('بدون فیلتر → همه', filterScenarioOfferings(list, { programId: 0, cohortId: 'ALL', weekFilter: 'ALL_VIEW' }).length, 4);
eq('رشتهٔ ۷ → عمومی + ۷', filterScenarioOfferings(list, { programId: 7, cohortId: 'ALL', weekFilter: 'ALL_VIEW' }).map(o => o.id), [1, 2, 3]);
eq('ورودی ۱۴۰۳ → عمومی + آن ورودی', filterScenarioOfferings(list, { programId: 0, cohortId: '1403', weekFilter: 'ALL_VIEW' }).map(o => o.id), [1, 2, 3, 4]);
eq('ورودی ۱۴۰۳ روی رشتهٔ ۷', filterScenarioOfferings(list, { programId: 7, cohortId: '1403', weekFilter: 'ALL_VIEW' }).map(o => o.id), [1, 2, 3]);
eq('نمای زوج → ALL و EVEN', filterScenarioOfferings(list, { programId: 0, cohortId: 'ALL', weekFilter: 'EVEN' }).map(o => o.id), [1, 2, 3, 4]);
eq('نمای فرد → فقط ALL', filterScenarioOfferings(list, { programId: 0, cohortId: 'ALL', weekFilter: 'ODD' }).map(o => o.id), [1, 2, 3]);
// تفکیک رشته‌به‌رشته با programIds: بدون تعلق = مشترک (همه‌جا)، با تعلق = فقط رشتهٔ خودش
const dl = [
  { ...base, id: 1, programId: 0, programIds: [], cohortId: 'ALL' },
  { ...base, id: 2, programId: 7, programIds: [7], cohortId: '1403-1' },
  { ...base, id: 3, programId: 8, programIds: [8], cohortId: '1404-1' },
  { ...base, id: 4, programId: 0, programIds: [7, 8], cohortId: 'ALL' },
];
eq('تقاضا: رشتهٔ ۷ (مشترک + خودش)', filterContextDemands(dl, { programId: 7, cohortId: 'ALL' }).map(x => x.id).sort(), [1, 2, 4]);
eq('تقاضا: رشتهٔ ۸ چیزی از رشتهٔ ۷ نمی‌بیند', filterContextDemands(dl, { programId: 8, cohortId: 'ALL' }).map(x => x.id).sort(), [1, 3, 4]);
eq('ترم چارت فیلتر می‌شود', filterContextDemands([{ ...base, id: 5, programIds: [7], semesterNo: 5 }, { ...base, id: 6, programIds: [7], semesterNo: 1 }], { programId: 7, cohortId: 'ALL', semester: 5 }).map(x => x.id), [5]);
// ورودی ۱۴۰۳۱ در نیمسال ۱۴۰۵۱ = ترم ۵
eq('ورودی ۱۴۰۳۱ در ۱۴۰۵۱ → ترم ۵', cohortSemesterNo(1403, 1, '14051'), 5);
eq('ورودی ۱۴۰۳۲ در ۱۴۰۵۱ → ترم ۴', cohortSemesterNo(1403, 2, '14051'), 4);
eq('ورودی آینده → null', cohortSemesterNo(1406, 1, '14051'), null);
// ترمِ دامنه: ورودیِ انتخاب‌شده بر چیپِ فاز ۰ اولویت دارد (فاز ۱ رشتهٔ ۴۴/ترم ۳)
eq('دامنه: بدون ورودی ⇒ چیپ فاز ۰', chartScopeSemester({ cohortId: 'ALL', entryYear: null, entryTerm: null, termCode: '14051', selectedSemester: 3 }), 3);
eq('دامنه: ورودی ۱۴۰۴-۱ ⇒ ترم ۳', chartScopeSemester({ cohortId: '1404-1', entryYear: 1404, entryTerm: 1, termCode: '14051', selectedSemester: 'ALL' }), 3);
eq('دامنه: کد ترم نامعتبر ⇒ برمی‌گردد به چیپ', chartScopeSemester({ cohortId: '1404-1', entryYear: 1404, entryTerm: 1, termCode: null, selectedSemester: 2 }), 2);
eq('تقاضا: نیمسال ورود ۱۴۰۴', filterContextDemands(dl, { programId: 0, cohortId: '1404-1' }).map(x => x.id).sort(), [1, 3, 4]);

console.log('\n۶) آمار بازرس، گروه بعدی و سهم‌بندی');
const io = [
  mkOff({ professorId: 1, units: 3, programTitle: 'کامپیوتر' }),
  mkOff({ professorId: 1, units: 2, programTitle: 'ریاضی', classSchedules: [{ ...mkOff().classSchedules[0], dayOfWeek: 2 }] }),
  mkOff({ professorId: 2, units: 4 }),
];
eq('مجموع واحد استاد', inspectorSummary(io.filter(o => o.professorId === 1), 16).totalUnits, 5);
eq('درصد سهمیه (۵/۱۶)', inspectorSummary(io.filter(o => o.professorId === 1), 16).quotaPercent, 31);
eq('سقف بیش از حد → سقف ۱۰۰٪', inspectorSummary(io, 2).quotaPercent, 100);
eq('سقف صفر → صفر، نه NaN', inspectorSummary(io, 0).quotaPercent, 0);
eq('روزهای در‌گیر', inspectorSummary(io.filter(o => o.professorId === 1), 16).distinctDays, 2);
eq('رشته‌های یکتا', inspectorSummary(io.filter(o => o.professorId === 1), 16).distinctPrograms, ['کامپیوتر', 'ریاضی']);
eq('هیچ ارائه‌ای → صفرها', inspectorSummary([], 16), { totalUnits: 0, groupsCount: 0, distinctDays: 0, distinctPrograms: [], quotaPercent: 0 });
eq('گروه اول وقتی چیزی نیست', nextGroupNumber([]), 1);
eq('بیشینه + ۱', nextGroupNumber([1, 3, 2]), 4);
eq('سهم متوازن', coTeachingWeights(50), { theory: 0.5, lab: 0.5 });
eq('سقف ۹۰٪ تئوری', coTeachingWeights(95), { theory: 0.9, lab: 0.1 });
eq('کف ۱۰٪ تئوری', coTeachingWeights(5), { theory: 0.1, lab: 0.9 });
const w33 = coTeachingWeights(33);
eq('مکملِ ۱ با تلورانس ممیز شناور', Math.round((w33.theory + w33.lab) * 100) / 100, 1);
eq('سهم ۳۳٪ دقیقاً ۰٫۳۳ است', [w33.theory, w33.lab], [0.33, 0.67]);

console.log('\n۷) آرایش زنگ تفریح و سناریوی واقعی');
eq('چهار فاز برچسب دارد', Object.keys(PHASE_LABELS).sort(), ['ALLOCATION', 'PUBLISHED', 'REVIEW', 'SUPPLY']);
eq('شش روز کاری', DAY_NAMES.length, 6);
for (const key of Object.keys(TIME_SLOT_PRESETS) as (keyof typeof TIME_SLOT_PRESETS)[]) {
  const p = TIME_SLOT_PRESETS[key];
  const bad = p.slots.filter((s, i) => {
    const dur = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    return dur(s.startTime) >= dur(s.endTime) || s.id !== i + 1;
  });
  eq(`«${key}» — اسلات‌ها مرتب، یکتا و با پایان بعد از شروع`, bad.length, 0);
  eq(`«${key}» — حداقل یک استراحت`, p.slots.filter(s => s.isBreak).length >= 1, true);
}
const scen = buildRealScenario(io, 0, 48, 7);
eq('بدون تداخل → «صفر»', scen.kpi.conflictsRate, 'صفر');
eq('تداخل سخت نمایش داده می‌شود', buildRealScenario(io, 3, 48, 7).kpi.conflictsRate, '۳ تداخل سخت');
eq('جلسات در KPI', scen.kpi.commuteScore, '۴۸ جلسه');
eq('بهره‌وری سالن = تعداد سهمیه', scen.kpi.roomEfficiency, '۷');
eq('روزهای distinct از همهٔ ارائه‌ها', scen.kpi.daysPerWeek, '۲');
eq('سناریو همان ارائه‌های ورودی است (بدون Solver)', scen.offerings.length, io.length);

console.log('\n۸) تب آغازین از query string (resolveTab)');
eq('مقدار معتبر همان تب است', resolveTab('SCENARIOS'), 'SCENARIOS');
eq('حروف کوچک هم پذیرفته می‌شود', resolveTab('approved'), 'APPROVED');
eq('فاصله اضافه پاک می‌شود', resolveTab('  DEPT_ROOMS  '), 'DEPT_ROOMS');
// فاز ۰ (انتخاب رشته و ترم) حالا تب اول است
 eq('undefined → فاز ۰', resolveTab(undefined), 'PROGRAM_SCOPE');
eq('null → فاز ۰', resolveTab(null), 'PROGRAM_SCOPE');
eq('رشتهٔ بی‌ربط → فاز ۰', resolveTab('../../etc/passwd'), 'PROGRAM_SCOPE');
eq('همهٔ تب‌های مشروع برگردانده می‌شوند', PLANNING_TABS.map(resolveTab), [...PLANNING_TABS]);

console.log('\n۹) پیشنهاد خودکار تعداد گروه از روی تعداد دانشجو');
// ورودی پرجمعیت باید خودکار چند گروه شود
eq('۹۰ دانشجو → ۳ گروه (۴۰ نفره)', suggestGroupsCount({ enrolled: 90 }), 3);
eq('۴۰ دانشجو → ۱ گروه', suggestGroupsCount({ enrolled: 40 }), 1);
eq('۴۱ دانشجو → ۲ گروه', suggestGroupsCount({ enrolled: 41 }), 2);
eq('ثبت‌نام صفر → از ظرفیت استفاده می‌شود', suggestGroupsCount({ enrolled: 0, capacity: 85 }), 3);
eq('بزرگ‌ترِ ثبت‌نام و ظرفیت مبنا است', suggestGroupsCount({ enrolled: 30, capacity: 120 }), 3);
eq('بدون داده → ۱ گروه', suggestGroupsCount({}), 1);
eq('ظرفیت گروه قابل تنظیم است', suggestGroupsCount({ enrolled: 90, maxPerGroup: 30 }), 3);
eq('سقف گروه‌ها رعایت می‌شود', suggestGroupsCount({ enrolled: 5000 }), MAX_GROUPS_PER_COURSE);

console.log('\n۹ب) تعداد گروه‌های موازی — آزاد و نرمال‌شده (clampGroupsCount)');
eq('۴ گروه پذیرفته می‌شود (قبلاً UI فقط ۱..۳ می‌داد)', clampGroupsCount(4), 4);
eq('۶ گروه پذیرفته می‌شود', clampGroupsCount(6), 6);
eq('صفر → حداقل ۱', clampGroupsCount(0), 1);
eq('منفی → ۱', clampGroupsCount(-5), 1);
eq('اعشار گِرد می‌شود', clampGroupsCount(3.6), 4);
eq('متن عددی پذیرفته می‌شود', clampGroupsCount('5'), 5);
eq('خالی/نامعتبر → ۱', clampGroupsCount(''), 1);
eq('undefined → ۱', clampGroupsCount(undefined), 1);
eq('سقف رعایت می‌شود', clampGroupsCount(999), MAX_GROUPS_PER_COURSE);
eq('سقف معقول است (۱..۲۰)', MAX_GROUPS_PER_COURSE >= 10 && MAX_GROUPS_PER_COURSE <= 30, true);

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
