/**
 * تست واحد هستهٔ خالص موتور برنامه‌ریزی درسی — بدون React و بدون DB
 *
 * اجرا: npm test
 * پوشش: اعتبارسنجی گروه‌ها (سقف ۲۰ گروه، ظرفیت، جنسیت، شیفت)، هم‌پوشانی
 * زمانی، امتیازدهی پیشنهادها (زونینگ دانشکده + ترجیح استاد + ظرفیت)،
 * پیش‌بینی تعداد گروه، توزیع سهمیهٔ کلاس‌ها، ماشین فازها و سلامت برنامه.
 */
import {
  allocateQuotaShifts, calculateSlotScore, canAllocateInPhase, canEditInPhase, countInternalGaps,
  canTransition, classifyUtilization, distributeGroupsByFaculty, GENDERS,
  MAX_GROUPS, overlaps, SCORE, shiftOf, shiftUtilization, suggestedGroupCount,
  toMinutes, validateGroupDrafts, type Shift,
  detectScheduleConflicts, hasHardConflicts, sessionDatesFor,
  type ScheduleConflictInput, type RoomCapacityInfo,
  computeSessionDates, detectHardConflicts, jalaliDateOf, parseJalaliDate,
} from '../src/lib/scheduling-core.ts';

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const throws = (name: string, fn: () => unknown, msgPart?: string) => {
  try {
    fn();
    fail++;
    console.log(`  ✗ ${name} (خطا نداد)`);
  } catch (e: any) {
    const ok = !msgPart || String(e?.message ?? e).includes(msgPart);
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name} — پیام: ${e?.message}`); }
  }
};

const mk = (over: Partial<Parameters<typeof validateGroupDrafts>[0][number]> = {}) => ({
  groupNumber: 1, capacity: 40, gender: 'MIXED' as const,
  professorId: 10, classroomId: 100, dayOfWeek: 2,
  startTime: '08:00', endTime: '09:30', ...over,
});

console.log('۱) اعتبارسنجی گروه‌های درسی (سقف ۲۰، ظرفیت، جنسیت، شیفت)');
throws('لیست خالی', () => validateGroupDrafts([], false), 'هیچ گروه درسی');
throws('۲۱ گروه', () => validateGroupDrafts(Array.from({ length: MAX_GROUPS + 1 }, (_, i) => mk({ groupNumber: i + 1 })), false), 'بیشتر است');
throws('شمارهٔ گروه صفر', () => validateGroupDrafts([mk({ groupNumber: 0 })], false), 'شمارهٔ گروه نامعتبر');
throws('شمارهٔ گروه تکراری', () => validateGroupDrafts([mk({ groupNumber: 1 }), mk({ groupNumber: 1 })], false), 'تکراری');
throws('ظرفیت ۳', () => validateGroupDrafts([mk({ capacity: 3 })], false), 'ظرفیت');
throws('ظرفیت ۶۰۰', () => validateGroupDrafts([mk({ capacity: 600 })], false), 'ظرفیت');
throws('ظرفیت اعشاری', () => validateGroupDrafts([mk({ capacity: 40.5 })], false), 'ظرفیت');
throws('جنسیت نامعتبر', () => validateGroupDrafts([mk({ gender: 'COED' as any })], false), 'جنسیت');
throws('استاد صفر', () => validateGroupDrafts([mk({ professorId: 0 })], false), 'استاد');
throws('کلاس صفر', () => validateGroupDrafts([mk({ classroomId: 0 })], false), 'کلاس فیزیکی');
eq('dayOfWeek 0 (Saturday) validates', validateGroupDrafts([mk({ dayOfWeek: 0 })], false).length, 1);
eq('dayOfWeek 6 (Friday) validates', validateGroupDrafts([mk({ dayOfWeek: 6 })], false).length, 1);
throws('روز منفی یک', () => validateGroupDrafts([mk({ dayOfWeek: -1 })], false), 'روز');
throws('روز هفت', () => validateGroupDrafts([mk({ dayOfWeek: 7 })], false), 'روز');
throws('پایان قبل از شروع', () => validateGroupDrafts([mk({ startTime: '10:00', endTime: '09:00' })], false), 'بازهٔ زمانی');
throws('مدت ۵ ساعت', () => validateGroupDrafts([mk({ startTime: '08:00', endTime: '13:00' })], false), '۴ ساعت');
throws('عبور از مرز شیفت (۱۰:۳۰–۱۳:۰۰)', () => validateGroupDrafts([mk({ startTime: '10:30', endTime: '13:00' })], false), 'مرز شیفت');
throws('قالب ساعت غلط', () => validateGroupDrafts([mk({ startTime: '8am' })], false), 'قالب ساعت');

{
  const out = validateGroupDrafts([mk({ groupNumber: 2, startTime: '14:00', endTime: '15:30' }), mk({ groupNumber: 1 })], false);
  eq('ترتیب صعودی شمارهٔ گروه', out.map(g => g.groupNumber), [1, 2]);
  eq('شیفت صبح ۰۸–۰۹:۳۰', out[0].shift, 'MORNING');
  eq('شیفت عصر ۱۴–۱۵:۳۰', out[1].shift, 'EVENING');
  eq('دقیقهٔ شروع نرمال', out[0].startMinutes, 480);
}

console.log('\n۲) ابزار زمان و هم‌پوشانی');
eq('toMinutes(08:30)=510', toMinutes('08:30'), 510);
throws('toMinutes غلط', () => toMinutes('25:00'), 'قالب ساعت');
eq('همپوشانی ۸-۱۰ با ۹-۱۱', overlaps(480, 600, 540, 660), true);
eq('تماس ۸-۱۰ و ۱۰-۱۲ تداخل نیست', overlaps(480, 600, 600, 720), false);
eq('زیرمجموعه', overlaps(480, 720, 500, 600), true);
eq('کاملاً جدا', overlaps(480, 540, 660, 720), false);
throws('shiftOf عبور از مرز', () => shiftOf(600, 780), 'مرز شیفت');

console.log('\n۳) امتیازدهی پیشنهادها (زونینگ + ترجیح + ظرفیت)');
{
  const best = calculateSlotScore({ roomFacultyId: 2, targetFacultyId: 2, inPreferredWindow: true, inAvailableWindow: true, roomCapacity: 50, requiredCapacity: 40 });
  eq('طلایی: همدانشکده + ترجیح + تناسب عالی = ۱۲۰', best.score, SCORE.sameFaculty + SCORE.preferredTime + SCORE.capacityPerfect);
  const cross = calculateSlotScore({ roomFacultyId: 3, targetFacultyId: 2, inPreferredWindow: false, inAvailableWindow: true, roomCapacity: 70, requiredCapacity: 40 });
  eq('بین‌دانشکده + غیرترجیح + تناسب خوب = ۴۰', cross.score, SCORE.crossFaculty + SCORE.okTime + SCORE.capacityGood);
  const capLow = calculateSlotScore({ roomFacultyId: 2, targetFacultyId: 2, inPreferredWindow: true, inAvailableWindow: true, roomCapacity: 30, requiredCapacity: 40 });
  eq('ظرفیت ناکافی → منفی (هرگز پیشنهاد نمی‌شود)', capLow.score, SCORE.capacityOver);
  eq('دلیل ظرفیت ناکافی', capLow.reasons[0].includes('کمتر از نیاز'), true);
  const noFac = calculateSlotScore({ roomFacultyId: null, targetFacultyId: null, inPreferredWindow: true, inAvailableWindow: true, roomCapacity: 40, requiredCapacity: 40 });

  // ── فشرده‌سازی روز استاد: «پشت سر هم، بدون ساعت خالی» ──
  const base = { roomFacultyId: 2, targetFacultyId: 2, inPreferredWindow: true, inAvailableWindow: true, roomCapacity: 40, requiredCapacity: 40 };
  const plain = calculateSlotScore({ ...base });
  const adjacent = calculateSlotScore({ ...base, adjacentToExisting: true });
  eq('اسلات چسبیده به کلاس موجود امتیاز بیشتری دارد', adjacent.score > plain.score, true);
  eq('پاداش چسبیدن = SCORE.adjacentBlock', adjacent.score - plain.score, SCORE.adjacentBlock);
  const sameDay = calculateSlotScore({ ...base, dayAlreadyUsed: true });
  eq('همان روزِ کلاس‌های دیگر امتیاز بیشتری دارد', sameDay.score > plain.score, true);
  const withGap = calculateSlotScore({ ...base, adjacentToExisting: true, gapsCreated: 1 });
  eq('ساعت خالی امتیاز را کم می‌کند', withGap.score < adjacent.score, true);
  eq('جریمهٔ یک ساعت خالی = SCORE.internalGap', withGap.score - adjacent.score, SCORE.internalGap);
  eq('دو ساعت خالی دو برابر جریمه', calculateSlotScore({ ...base, gapsCreated: 2 }).score - plain.score, SCORE.internalGap * 2);
  eq('بدون ساعت خالی جریمه‌ای نیست', plain.score, calculateSlotScore({ ...base, gapsCreated: 0 }).score);

  // countInternalGaps
  eq('۸-۱۰ و ۱۲-۱۴ → یک ساعت خالی', countInternalGaps([{ start: 480, end: 600 }, { start: 720, end: 840 }]), 1);
  eq('۸-۱۰ و ۱۰-۱۲ → بدون خالی', countInternalGaps([{ start: 480, end: 600 }, { start: 600, end: 720 }]), 0);
  eq('یک بلوک → بدون خالی', countInternalGaps([{ start: 480, end: 600 }]), 0);
  eq('سه بلوک پشت سر هم → بدون خالی', countInternalGaps([{ start: 480, end: 600 }, { start: 600, end: 720 }, { start: 720, end: 840 }]), 0);
  eq('سه بلوک با دو فاصله → ۲', countInternalGaps([{ start: 480, end: 600 }, { start: 660, end: 720 }, { start: 780, end: 840 }]), 2);
  eq('ترتیب ورودی مهم نیست', countInternalGaps([{ start: 720, end: 840 }, { start: 480, end: 600 }]), 1);
  eq('بدون دانشکدهٔ هدف → امتیاز پایهٔ مکانی', noFac.score, SCORE.crossFaculty + SCORE.preferredTime + SCORE.capacityPerfect);
  const noAvail = calculateSlotScore({ roomFacultyId: 2, targetFacultyId: 2, inPreferredWindow: false, inAvailableWindow: false, roomCapacity: 40, requiredCapacity: 40 });
  eq('خارج از ساعات حضور → -۱۰۰', noAvail.score, -100);
  const overCap = calculateSlotScore({ roomFacultyId: 2, targetFacultyId: 2, inPreferredWindow: true, inAvailableWindow: true, roomCapacity: 100, requiredCapacity: 40 });
  eq('مازاد ≥۴۰ نفر → بدون امتیاز ظرفیت', overCap.score, SCORE.sameFaculty + SCORE.preferredTime);
}

console.log('\n۴) پیش‌بینی تعداد گروه از تقاضا');
eq('صفر متقاضی → ۱ گروه (حفظ درس)', suggestedGroupCount(0, 40), 1);
eq('۳۹ نفر → ۱ گروه', suggestedGroupCount(39, 40), 1);
eq('۴۱ نفر → ۲ گروه', suggestedGroupCount(41, 40), 2);
eq('۲۱۰ نفر → ۶ گروه', suggestedGroupCount(210, 40), 6);
eq('سقف ۲۰ گروه', suggestedGroupCount(900, 40), MAX_GROUPS);
throws('ظرفیت صفر', () => suggestedGroupCount(10, 0), 'ظرفیت استاندارد');
throws('متقاضی منفی', () => suggestedGroupCount(-5, 40), 'نامعتبر');

{
  const dist = distributeGroupsByFaculty(
    [{ facultyId: 1, eligible: 55 }, { facultyId: 2, eligible: 15 }], 40);
  eq('دانشکدهٔ پرجمعیت اول و ۲ گروه', [dist[0].facultyId, dist[0].groups], [1, 2]);
  eq('دانشکدهٔ کم‌جمعیت ۱ گروه', dist[1].groups, 1);
}

console.log('\n۵) توزیع سهمیهٔ (سالن، شیفت)');
{
  const rooms = [
    { classroomId: 1, capacity: 100, shifts: ['MORNING','EVENING'] as Shift[] },
    { classroomId: 2, capacity: 60, shifts: ['MORNING','EVENING'] as Shift[] },
  ];
  const grants = allocateQuotaShifts(rooms, [
    { departmentId: 10, activeStudents: 300 }, { departmentId: 20, activeStudents: 100 },
  ]);
  eq('جمع گرنت‌ها = اسلات‌ها (۴)', grants.length, 4);
  const d10 = grants.filter(g => g.departmentId === 10).length;
  const d20 = grants.filter(g => g.departmentId === 20).length;
  eq('سهم ۷۵٪ → ۳ اسلات', d10, 3);
  eq('سهم ۲۵٪ → ۱ اسلات', d20, 1);
  eq('سالن بزرگ‌تر اول به گروه پرجمعیت', grants[0].classroomId, 1);
  const equal = allocateQuotaShifts(rooms, [
    { departmentId: 10, activeStudents: 50 }, { departmentId: 20, activeStudents: 50 },
  ]);
  const e10 = equal.filter(g => g.departmentId === 10).length;
  eq('مساوی → ۲/۲', e10, 2);
  eq('بدون دانشجو → بدون گرنت', allocateQuotaShifts(rooms, []).length, 0);
}

console.log('\n۶) ماشین فازها و سلامت');
eq('SUPPLY→ALLOCATION مجاز', canTransition('SUPPLY', 'ALLOCATION'), true);
eq('SUPPLY→REVIEW ناقانونی', canTransition('SUPPLY', 'REVIEW'), false);
eq('REVIEW→PUBLISHED مجاز', canTransition('REVIEW', 'PUBLISHED'), true);
eq('PUBLISHED→جایی ممنوع', canTransition('PUBLISHED', 'REVIEW'), false);
eq('ویرایش در SUPPLY مجاز', canEditInPhase('SUPPLY'), true);
eq('ویرایش در PUBLISHED ممنوع', canEditInPhase('PUBLISHED'), false);
eq('تخصیص در SUPPLY ممنوع', canAllocateInPhase('SUPPLY'), false);
eq('تخصیص در ALLOCATION مجاز', canAllocateInPhase('ALLOCATION'), true);
eq('تخصیص در PUBLISHED ممنوع', canAllocateInPhase('PUBLISHED'), false);
eq('۲۰/۴۰ = UNDERFILLED', classifyUtilization(20, 40), 'UNDERFILLED');
eq('۳۰/۴۰ = NORMAL', classifyUtilization(30, 40), 'NORMAL');
eq('۳۶/۴۰ = FULL', classifyUtilization(36, 40), 'FULL');
eq('۴۱/۴۰ = OVERBOOKED', classifyUtilization(41, 40), 'OVERBOOKED');
eq('ظرفیت صفر = OVERBOOKED', classifyUtilization(0, 0), 'OVERBOOKED');
eq('نیم‌شیفت استفاده = ۰٫۵', shiftUtilization(120, 240), 0.5);
eq('شیفت خالی = ۰', shiftUtilization(0, 240), 0);


// ─────────────────────── فاز ۶: قیود سخت + تاریخ جلسات ───────────────────────
console.log('— فاز ۶: قیود سخت برنامهٔ هفتگی و تاریخ جلسات —');

const rooms: RoomCapacityInfo[] = [
  { id: 1, capacity: 40, title: 'کلاس ۱۰۱' },
  { id: 2, capacity: 20, title: 'کلاس ۱۰۲' },
];

const sched = (o: Partial<ScheduleConflictInput>): ScheduleConflictInput => ({
  offeringId: o.offeringId ?? 0, groupNumber: 1, dayOfWeek: 1,
  startTime: '08:00', endTime: '10:00', roomId: 1, requiredCapacity: 30,
  professorIds: [], offeringTitle: `درس ${o.offeringId ?? 0}`,
  ...o,
});

// بدون تداخل
const clean = detectScheduleConflicts([
  sched({ offeringId: 1, dayOfWeek: 1, startTime: '08:00', endTime: '09:30' }),
  sched({ offeringId: 2, dayOfWeek: 1, startTime: '10:00', endTime: '11:30' }),
], rooms);
eq('برنامهٔ بدون تداخل → بدون یافته', clean.length, 0);
eq('hasHardConflicts خالی → false', hasHardConflicts(clean), false);

// ROOM_OVERLAP: دو کلاس هم‌زمان یک سالن
const roomOverlap = detectScheduleConflicts([
  sched({ offeringId: 1, dayOfWeek: 2, startTime: '08:00', endTime: '10:00', roomId: 1 }),
  sched({ offeringId: 2, dayOfWeek: 2, startTime: '09:00', endTime: '11:00', roomId: 1 }),
], rooms);
eq('تداخل سالن → ROOM_OVERLAP', roomOverlap.some(c => c.type === 'ROOM_OVERLAP'), true);
eq('offeringIds هر دو', roomOverlap.find(c => c.type === 'ROOM_OVERLAP')?.offeringIds.join(','), '1,2');
eq('hasHardConflicts → true', hasHardConflicts(roomOverlap), true);

// چند سالن → بدون تداخل
eq('سالن‌های متفاوت هم‌زمان → بی‌یافته',
  detectScheduleConflicts([
    sched({ offeringId: 1, dayOfWeek: 2, startTime: '08:00', endTime: '10:00', roomId: 1 }),
    sched({ offeringId: 2, dayOfWeek: 2, startTime: '08:00', endTime: '10:00', roomId: 2 }),
  ], rooms).some(c => c.type === 'ROOM_OVERLAP'), false);

// PROFESSOR_OVERLAP: استاد دوم (Co-Teaching) هم شکار می‌شود
const profOverlap = detectScheduleConflicts([
  sched({ offeringId: 1, dayOfWeek: 3, startTime: '08:00', endTime: '10:00', professorIds: [7] }),
  sched({ offeringId: 2, dayOfWeek: 3, startTime: '09:00', endTime: '11:00', professorIds: [8, 7] }), // استاد دوم 7
], rooms);
eq('تداخل استاد دوم → PROFESSOR_OVERLAP', profOverlap.some(c => c.type === 'PROFESSOR_OVERLAP'), true);

// استاد در روزهای مختلف → بی‌یافته
eq('استاد در روزهای جدا → بی‌یافته',
  detectScheduleConflicts([
    sched({ offeringId: 1, dayOfWeek: 1, startTime: '08:00', endTime: '10:00', professorIds: [7] }),
    sched({ offeringId: 2, dayOfWeek: 2, startTime: '08:00', endTime: '10:00', professorIds: [7] }),
  ], rooms).some(c => c.type === 'PROFESSOR_OVERLAP'), false);

// ROOM_CAPACITY
const capIssue = detectScheduleConflicts([
  sched({ offeringId: 9, requiredCapacity: 50, roomId: 1 }), // سالن ۱ فقط ۴۰
], rooms);
eq('ظرفیت کلاس > ظرفیت سالن → ROOM_CAPACITY', capIssue.some(c => c.type === 'ROOM_CAPACITY'), true);

// sessionDatesFor: شنبه (dayOfWeek=0) — اولین جلسه = همان شنبهٔ هفتهٔ اول
const start = new Date('2025-09-20T00:00:00Z'); // شنبه
const all = sessionDatesFor(start, 0, 'ALL', 16);
eq('ALL → ۱۶ جلسه', all.length, 16);
eq('sessionNo ها ۱..۱۶', all[0].sessionNo, 1);
eq('جلسهٔ آخر = هفتهٔ ۱۶', all[15].sessionNo, 16);
eq('فاصلهٔ هفتگی دقیق', (all[1].date.getTime() - all[0].date.getTime()) / 86400000, 7);
eq('تاریخ جلسهٔ ۱ = شنبه شروع', all[0].date.toISOString().slice(0, 10), '2025-09-20');

// یکشنبه (dayOfWeek=1) → یک روز بعد از شنبهٔ شروع
const sun = sessionDatesFor(start, 1, 'ALL', 4);
eq('یکشنبه = +۱ روز', sun[0].date.toISOString().slice(0, 10), '2025-09-21');

const fri = sessionDatesFor(start, 6, 'ALL', 4);
eq('Friday day 6 is valid', fri.length, 4);
eq('Friday = +6 days', fri[0].date.toISOString().slice(0, 10), '2025-09-26');
eq('Friday weekly step', (fri[1].date.getTime() - fri[0].date.getTime()) / 86400000, 7);

// EVEN → فقط هفته‌های زوج (۸ جلسه، sessionNo های ۱..۸)
const even = sessionDatesFor(start, 0, 'EVEN', 16);
eq('EVEN → ۸ جلسه', even.length, 8);
eq('اولین جلسهٔ EVEN هفتهٔ ۲ (شنبهٔ بعدی)', even[0].date.toISOString().slice(0, 10), '2025-09-27');

// ODD → هفته‌های فرد
const odd = sessionDatesFor(start, 0, 'ODD', 16);
eq('ODD → ۸ جلسه', odd.length, 8);
eq('اولین جلسهٔ ODD = هفتهٔ ۱', odd[0].date.toISOString().slice(0, 10), '2025-09-20');

// روز نامعتبر
eq('روز خارج از ۰..۶ → خالی', sessionDatesFor(start, 9, 'ALL', 16), []);
eq('روز ۷ → خالی', sessionDatesFor(start, 7, 'ALL', 16), []);
eq('روز منفی → خالی', sessionDatesFor(start, -1, 'ALL', 16), []);

console.log('\n۷) قیود سخت V2 (استاد+دوم، سالن، ظرفیت)');
{
  const row = (over: Partial<Parameters<typeof detectHardConflicts>[0][number]>) => ({
    offeringId: 1, groupNumber: 1, courseCode: 'C1', professorIds: [10], roomId: 100,
    dayOfWeek: 2, startMinutes: 8 * 60, endMinutes: 9 * 60 + 30,
    enrolledCount: 30, capacity: 40, ...over,
  });
  eq('بدون تداخل → خالی', detectHardConflicts([row({}), row({ offeringId: 2, courseCode: 'C2', professorIds: [11], roomId: 101, dayOfWeek: 3 })]).length, 0);
  eq('استاد مشترک هم‌زمان → PROFESSOR_OVERLAP',
    detectHardConflicts([row({}), row({ offeringId: 2, courseCode: 'C2', professorIds: [10], roomId: 101 })])[0].kind,
    'PROFESSOR_OVERLAP');
  eq('استاد دوم (Co-Teaching) هم‌زمان → تداخل',
    detectHardConflicts([row({ professorIds: [10, 12] }), row({ offeringId: 2, courseCode: 'C2', professorIds: [12], roomId: 101 })])[0].kind,
    'PROFESSOR_OVERLAP');
  eq('استاد مشترک در روزهای مختلف → بدون تداخل',
    detectHardConflicts([row({}), row({ offeringId: 2, courseCode: 'C2', professorIds: [10], roomId: 101, dayOfWeek: 4 })]).length, 0);
  const roomConf = detectHardConflicts([row({}), row({ offeringId: 2, courseCode: 'C2', professorIds: [11], roomId: 100, startMinutes: 9 * 60, endMinutes: 10 * 60 })]);
  eq('سالن مشترک هم‌زمان → ROOM_OVERLAP', roomConf[0].kind, 'ROOM_OVERLAP');
  eq('سالن مشترک غیرهم‌زمان → بدون تداخل',
    detectHardConflicts([row({}), row({ offeringId: 2, courseCode: 'C2', professorIds: [11], roomId: 100, startMinutes: 10 * 60, endMinutes: 11 * 60 })]).length, 0);
  const cap = detectHardConflicts([row({ enrolledCount: 45, capacity: 40 })]);
  eq('ظرفیت ۴۰ < ثبت‌نام ۴۵ → CAPACITY_OVERFLOW', cap[0].kind, 'CAPACITY_OVERFLOW');
  eq('ظرفیت نامشخص (۰) → بدون خطای کاذب', detectHardConflicts([row({ capacity: 0, enrolledCount: 100 })]).length, 0);
  const multi = detectHardConflicts([
    row({}), row({ offeringId: 2, courseCode: 'C2', professorIds: [10], roomId: 100 }),
    row({ offeringId: 3, courseCode: 'C3', professorIds: [11], roomId: 100, startMinutes: 8 * 60, endMinutes: 9 * 60 }),
  ]);
  // A↔B: استاد + سالن (۲) · A↔C: سالن (۱) · B↔C: سالن (۱) = ۴
  eq('هم‌زمانی سه‌گانه → ۴ تداخل (۲ استاد + ۴ سالن؟ درست: ۴)', multi.length, 4);
}

console.log('\n۸) مولد تاریخ جلسات (شمسی، زوج/فرد، تعطیلات)');
{
  // شنبه ۱۴۰۵/۰۶/۲۹ = 2026-09-20 (بررسی با خود کتابخانه: سازگاری رفت‌وبرگشت)
  const [parse1, parse2] = [parseJalaliDate('1405/06/29'), parseJalaliDate('1405/01/01')];
  eq('برگشت شمسی ۱۴۰۵/۰۶/۲۹', jalaliDateOf(parse1), '1405/06/29');
  eq('برگشت شمسی ۱۴۰۵/۰۱/۰۱', jalaliDateOf(parse2), '1405/01/01');
  throws('قالب غلط تاریخ', () => parseJalaliDate('۱۴۰۵/۰۶/۲۹'), 'قالب');

  // ۱۴۰۵/۰۶/۲۹ = یکشنبه (2026-09-20) → اولین شنبه = ۱۴۰۵/۰۷/۰۴
  const start = parseJalaliDate('1405/06/29');
  const all = computeSessionDates({ termStart: start, dayOfWeek: 0, sessionsCount: 16 });
  eq('۱۶ جلسهٔ هفتگی شنبه', all.length, 16);
  eq('جلسهٔ اول: نخستین شنبه بعد از شروع', all[0].jalaliDate, '1405/07/04');
  eq('جلسهٔ دوم: ۷ روز بعد', all[1].jalaliDate, '1405/07/11');
  eq('شمارهٔ جلسات متوالی', all.map(s => s.sessionNo).join(','), Array.from({ length: 16 }, (_, i) => i + 1).join(','));
  eq('جلسهٔ چهارم: سه شنبه هفتهٔ بعد (۱۴۰۵/۰۷/۲۵)', all[3].jalaliDate, '1405/07/25');

  const holiday = computeSessionDates({ termStart: start, dayOfWeek: 0, sessionsCount: 8, holidays: ['1405/07/11'] });
  eq('تعطیل رسمی → پرش و ۸ جلسه', holiday.length, 8);
  eq('جلسهٔ پرش‌شده حذف و جلسهٔ بعد جایگزین', holiday[1].jalaliDate, '1405/07/18');

  const even = computeSessionDates({ termStart: start, dayOfWeek: 0, sessionsCount: 4, recurrence: 'EVEN' });
  eq('هفتهٔ زوج: ۰۷/۱۱ (هفتهٔ دوم)', even[0].jalaliDate, '1405/07/11');
  const odd = computeSessionDates({ termStart: start, dayOfWeek: 0, sessionsCount: 4, recurrence: 'ODD' });
  eq('هفتهٔ فرد: ۰۷/۰۴ (هفتهٔ اول)', odd[0].jalaliDate, '1405/07/04');
  throws('روز منفی یک', () => computeSessionDates({ termStart: start, dayOfWeek: -1, sessionsCount: 4 }), 'روز');
  throws('روز هفت', () => computeSessionDates({ termStart: start, dayOfWeek: 7, sessionsCount: 4 }), 'روز');
  const friJ = computeSessionDates({ termStart: start, dayOfWeek: 6, sessionsCount: 3 });
  eq('Friday sessions count', friJ.length, 3);
  eq('Friday first date', friJ[0].jalaliDate, '1405/07/03');
  throws('day 8 invalid', () => computeSessionDates({ termStart: start, dayOfWeek: 8, sessionsCount: 4 }));
  throws('جلسات ۷۰', () => computeSessionDates({ termStart: start, dayOfWeek: 0, sessionsCount: 70 }), 'تعداد جلسات');

  // چهارشنبه (روز ۴): ۱۴۰۵/۰۶/۲۹ یکشنبه → اولین چهارشنبه = ۱۴۰۵/۰۷/۰۱
  const wed = computeSessionDates({ termStart: start, dayOfWeek: 4, sessionsCount: 3 });
  eq('اولین چهارشنبهٔ بعد از شروع (۱۴۰۵/۰۷/۰۱)', wed[0].jalaliDate, '1405/07/01');

  // لنگر تقویمی واقعی: ۱۴۰۳/۰۸/۰۵ شنبه بود (2024-10-26 میلادی، شنبه)
  eq('لنگر شنبه: میلادی→شمسی', jalaliDateOf(new Date(2024, 9, 26)), '1403/08/05');
  eq('لنگر شنبه واقعاً شنبه است', parseJalaliDate('1403/08/05').getDay(), 6);
  const satSessions = computeSessionDates({ termStart: parseJalaliDate('1403/08/01'), dayOfWeek: 0, sessionsCount: 4 });
  eq('هر ۴ جلسهٔ روز ۰ شنبه‌اند', satSessions.map(s => parseJalaliDate(s.jalaliDate).getDay()), [6, 6, 6, 6]);
  eq('نخستین شنبهٔ بعد از ۱۴۰۳/۰۸/۰۱', satSessions[0].jalaliDate, '1403/08/05');
}

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
