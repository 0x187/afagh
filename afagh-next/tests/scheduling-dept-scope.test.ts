/**
 * ════════════════════════════════════════════════════════════════════════
 *  گیت «دامنهٔ مدیرگروه» — چهار ایرادی که کاربرِ مدیرگروه برق گزارش کرد
 *
 *  دادهٔ واقعیِ بررسی‌شده روی پایگاه‌دادهٔ زنده (رشتهٔ ۴۴ / ترم ۱۱۱):
 *    ① گام ۱: ۱۴ ردیفِ ترم ۳ برمی‌گشت که **۷ ردیفش «انقلاب اسلامی»** (گروه
 *       معارف، dept 43) بود — دروسِ عمومی نباید در تابلوی گروه تخصصی بیاید.
 *    ② گام ۲: «واحد اساتید تخصصی» از برشِ چارتِ همان ترم حساب می‌شد؛ استادی
 *       که درسش در ترمِ دیگری از چارت بود «۰ واحد» دیده می‌شد.
 *    ③ گام ۳: `allocatedRoomIds` سهمیهٔ *همهٔ* گروه‌ها را داشت و کلاس‌های
 *       تربیت‌بدنی (dept 8) را به مدیرگروه برق نشان می‌داد.
 *    ④ گام ۵: استادِ پیش‌فرض کم‌درس بود و جدول تقریباً خالی دیده می‌شد.
 *
 *  این تست دو لایه دارد: رفتارِ توابعِ خالص + گاردِ منبع (که مسیر واقعی از
 *  همان توابع استفاده کند و رفتارِ باگ‌دار برنگردد).
 * ════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeDemandsToDepts, scopeClassroomsToDepts } from '../src/app/admin/scheduling/planning-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHED = path.join(HERE, '..', 'src', 'app', 'admin', 'scheduling');
const read = (p: string) => readFileSync(path.join(SCHED, p), 'utf8');
const ACTIONS_SRC = read('actions.ts');
const PROVIDER_SRC = read('PlanningProvider.tsx');
const ROOMS_SRC = read(path.join('components', 'DeptRoomsTab.tsx'));
const WEEKLY_SRC = read(path.join('components', 'WeeklyMatrixTab.tsx'));

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m}`); }
};

// ───────────────────────── ① دامنهٔ تقاضاها (گام ۱) ─────────────────────────
console.log('\n▶ scopeDemandsToDepts — دروسِ گروه‌های دیگر حذف می‌شوند');
{
  const deptIds = [21, 40, 77]; // دپارتمان‌های تحت مدیریتِ مدیرگروه برق
  const demands = [
    { id: 1, courseDeptId: 77, title: 'ماشین‌های الکتریکی' },   // برق — بماند
    { id: 2, courseDeptId: 40, title: 'مقاومت مصالح' },          // عمران — بماند
    { id: 3, courseDeptId: 43, title: 'انقلاب اسلامی' },         // معارف — حذف
    { id: 4, courseDeptId: 43, title: 'انقلاب اسلامی' },         // معارف — حذف
    { id: 5, courseDeptId: 27, title: 'ریاضی ۲' },               // علوم پایه — حذف
    { id: 6, courseDeptId: null, title: 'بدون گروه' },           // نامشخص — حذف
  ];
  const kept = scopeDemandsToDepts(demands, deptIds);
  ok(kept.length === 2, 'از ۶ ردیف، فقط ۲ ردیفِ گروه خودش می‌ماند');
  ok(kept.every(d => d.courseDeptId === 77 || d.courseDeptId === 40), 'هیچ ردیفِ معارف/علوم پایه نمانده');
  ok(!kept.some(d => d.title === 'انقلاب اسلامی'), '«انقلاب اسلامی» حذف شده است');

  // دقیقاً همان ۱۴ ردیفِ واقعیِ ترم ۳: ۷ برق + ۷ انقلاب ⇒ باید ۷ بماند
  const real = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: i, courseDeptId: 77 })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: 100 + i, courseDeptId: 43 })),
  ];
  ok(scopeDemandsToDepts(real, deptIds).length === 7, 'دادهٔ واقعی ترم ۳: ۱۴ → ۷ ردیف');

  // fail-closed
  ok(scopeDemandsToDepts(demands, []).length === 0, 'بدونِ دپارتمان ⇒ هیچ (fail-closed)');
}

// ───────────────────────── ③ دامنهٔ سالن‌ها (گام ۳) ─────────────────────────
console.log('\n▶ scopeClassroomsToDepts — باشگاه‌های تربیت‌بدنی دیده نمی‌شوند');
{
  const facultyIds = [5];       // دانشکدهٔ فنی و مهندسی (دپارتمان‌های ۲۱/۴۰/۷۷)
  const deptIds = [21, 40, 77];
  const allocated = [104];      // سالنی که سهمیه‌اش به همین گروه داده شده
  const rooms = [
    { id: 70, facultyId: 5, departmentId: null },   // کلاس فنی — بماند (دانشکده)
    { id: 74, facultyId: 5, departmentId: null },   // کلاس فنی — بماند
    { id: 83, facultyId: 3, departmentId: 8 },      // باشگاه شیرزاد (تربیت‌بدنی) — حذف
    { id: 18, facultyId: 3, departmentId: 8 },      // باشگاه دادگستری — حذف
    { id: 200, facultyId: null, departmentId: 77 }, // اتاقِ اختصاصیِ برق — بماند
    { id: 104, facultyId: 3, departmentId: 8 },     // سهمیه‌گرفته — بماند (allocated)
    { id: 999, facultyId: null, departmentId: null }, // بی‌صاحب — حذف
  ];
  const kept = scopeClassroomsToDepts(rooms, facultyIds, deptIds, allocated);
  ok(kept.length === 4, 'از ۷ سالن، ۴ سالنِ مرتبط می‌ماند');
  ok(!kept.some(r => r.id === 83 || r.id === 18), 'باشگاه‌های تربیت‌بدنی حذف شدند');
  ok(kept.some(r => r.id === 104), 'سالنِ سهمیه‌گرفته‌ی خودِ گروه حفظ شد');
  ok(kept.some(r => r.id === 70), 'سالن‌های دانشکدهٔ خودش حفظ شدند');

  // دادهٔ واقعی: ۱۳۸ سالن دانشگاه؛ دانشکدهٔ ۵ = ۲۶ سالن ⇒ نباید ۱۳۸ بماند
  const all = Array.from({ length: 138 }, (_, i) => ({ id: i, facultyId: i < 26 ? 5 : 3, departmentId: i < 26 ? null : 8 }));
  const scoped = scopeClassroomsToDepts(all, facultyIds, deptIds, []);
  ok(scoped.length === 26, 'دادهٔ واقعی: ۱۳۸ → ۲۶ سالنِ دانشکدهٔ خودش');
}

// ───────────────────── ② گاردِ منبع: واحد استاد (گام ۲) ─────────────────────
console.log('\n▶ گارد منبع: بار واحد از همهٔ ارائه‌های ترم حساب می‌شود');
{
  ok(
    PROVIDER_SRC.includes('computeProfUnits(courseDemands, professors)'),
    'computeProfUnits از courseDemands (همهٔ ترم) می‌خواند',
  );
  ok(
    !/computeProfUnits\(\s*curriculumDemands\.length\s*>\s*0/.test(PROVIDER_SRC),
    'الگوی باگ‌دارِ «برشِ چارت» حذف شده است',
  );
}

// ───────────────────── ①③ گاردِ منبع: مسیرِ سرور ─────────────────────
console.log('\n▶ گارد منبع: اکشن‌های سرور از توابعِ دامنه استفاده می‌کنند');
{
  ok(
    ACTIONS_SRC.includes('scopeDemandsToDepts(allDemands, scopedDeptIds)'),
    'تقاضای چارت به دپارتمان‌های مدیرگروه محدود می‌شود',
  );
  ok(
    ACTIONS_SRC.includes('scopeClassroomsToDepts(classrooms, facIds, deptIds, allocatedRoomIds)'),
    'سالن‌ها به دانشکدهٔ مدیرگروه محدود می‌شوند',
  );
  ok(
    ACTIONS_SRC.includes('hasOwnCourse'),
    'رشته‌ای که زیرِ دپارتمانِ دیگری است ولی درسش در این گروه است مجاز می‌ماند',
  );
  ok(
    !ACTIONS_SRC.includes('allocatedRoomIds.includes(c.id)'),
    'سالن‌ها دیگر با «هر سهمیهٔ هر گروهی» فیلتر نمی‌شوند',
  );
}

// ───────────────────── ③ گاردِ منبع: تب سالن (گام ۳) ─────────────────────
console.log('\n▶ گارد منبع: تب سالن سالن‌های گروه‌های دیگر را نشان نمی‌دهد');
{
  ok(
    !ROOMS_SRC.includes('isDeptScope ? classrooms.filter(c => c.isAllocatedToDept) : classrooms'),
    'فیلترِ «هر سالنِ سهمیه‌دار» حذف شده است',
  );
  ok(
    ROOMS_SRC.includes('const visibleRooms = classrooms'),
    'سالن‌های محدودشدهٔ سرور نمایش داده می‌شوند',
  );
}

// ───────────────────── ④ گاردِ منبع: گام ۵ (برنامهٔ استاد) ─────────────────────
console.log('\n▶ گارد منبع: گام ۵ خالی به‌نظر نمی‌رسد');
{
  ok(
    WEEKLY_SRC.includes('unmatchedOfferings'),
    'درس‌های خارج از زنگ‌های تعریف‌شده جداگانه نمایش داده می‌شوند',
  );
  ok(
    WEEKLY_SRC.includes('این استاد در این ترم درسِ ثبت‌شده‌ای ندارد'),
    'حالتِ خالی پیامِ روشن دارد',
  );
  ok(
    PROVIDER_SRC.includes('bestN'),
    'استادِ پیش‌فرض بر اساس تعداد درس انتخاب می‌شود (نه اولین استاد)',
  );
}

console.log(`\n${fail === 0 ? '✅' : '❌'} scheduling-dept-scope: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
