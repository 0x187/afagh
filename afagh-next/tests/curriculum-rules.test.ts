/**
 * تست واحد «قواعد مؤثر نسخه» — بدون DB.
 *
 * چرا: قواعد در `course_rules` مقیّد به نسخه‌اند، ولی منبع اصلی
 * پیش‌نیاز/هم‌نیاز «جدول دروس» سراسری است. اگر fallback نباشد، هر درسی که
 * تازه به چارت اضافه شود تا همگام‌سازی دستی هیچ هشداری نمی‌دهد.
 */
import { buildRulesWithCatalogFallback } from '../src/lib/curriculum-rules.ts';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      انتظار: ${JSON.stringify(want)}\n      دریافت: ${JSON.stringify(got)}`); }
}

const stored = (courseId: number, ruleType: string, tree: unknown) =>
  ({ courseId, ruleType, logicTree: JSON.stringify(tree) });

console.log('— قواعد مؤثر نسخه (نسخه + fallback جدول دروس) —');

console.log('\n۱) قاعدهٔ نسخه بر جدول دروس مقدم است');
const r1 = buildRulesWithCatalogFallback(
  [{ courseId: 1, prereqText: 'CM100' }],
  [stored(1, 'PREREQ', { operator: 'AND', conditions: [{ course: 'CM200' }] })],
);
eq('فقط یک قاعده', r1.length, 1);
eq('کد نسخه حفظ شد', r1[0].logicTree.conditions, [{ course: 'CM200' }]);

console.log('\n۲) بدون قاعدهٔ نسخه → از جدول دروس ساخته می‌شود');
// از کامیت 9c27032 به بعد: «&» یعنی «و» و «|» یعنی «یا» (دروس هم‌ارز).
const r2 = buildRulesWithCatalogFallback([{ courseId: 2, prereqText: 'CM101&CM102' }], []);
eq('یک قاعده ساخته شد', r2.length, 1);
eq('نوع PREREQ', r2[0].ruleType, 'PREREQ');
eq('هر دو کد با AND', r2[0].logicTree, { operator: 'AND', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });

// «|» سما = «یا» (هم‌ارز)، نه «و»
const r2b = buildRulesWithCatalogFallback([{ courseId: 5, prereqText: 'CM101|CM102' }], []);
eq('لولهٔ سما → OR', r2b[0].logicTree.operator, 'OR');

console.log('\n۳) «یا» در متن → OR');
const r3 = buildRulesWithCatalogFallback([{ courseId: 3, prereqText: 'CM101 یا CM102' }], []);
eq('عملگر OR', r3[0].logicTree.operator, 'OR');

console.log('\n۴) هم‌نیاز از ستون coRequisites');
const r4 = buildRulesWithCatalogFallback([{ courseId: 4, coRequisites: 'CM103,CM104' }], []);
eq('یک قاعده COREQ', r4.length, 1);
eq('نوع COREQ', r4[0].ruleType, 'COREQ');
eq('دو کد', r4[0].logicTree.conditions.length, 2);

console.log('\n۵) متن خالی / «ندارد» → قاعده‌ای ساخته نمی‌شود');
eq('prereqText خالی', buildRulesWithCatalogFallback([{ courseId: 5, prereqText: '' }], []).length, 0);
eq('«ندارد»', buildRulesWithCatalogFallback([{ courseId: 5, prereqText: 'ندارد' }], []).length, 0);
eq('null', buildRulesWithCatalogFallback([{ courseId: 5, prereqText: null }], []).length, 0);

console.log('\n۶) قاعدهٔ معیوب در DB باعث خطا نمی‌شود');
const r6 = buildRulesWithCatalogFallback([], [{ courseId: 6, ruleType: 'PREREQ', logicTree: '{not json' }]);
eq('درخت خالی AND', r6[0].logicTree, { operator: 'AND', conditions: [] });

console.log('\n۷) هم‌نیازِ ثبت‌شده + پیش‌نیازِ جدول دروس با هم');
const r7 = buildRulesWithCatalogFallback(
  [{ courseId: 7, prereqText: 'CM101', coRequisites: 'CM102' }],
  [stored(7, 'COREQ', { operator: 'AND', conditions: [{ course: 'CM999' }] })],
);
eq('دو قاعده', r7.length, 2);
eq('COREQ از نسخه', r7.find(r => r.ruleType === 'COREQ')!.logicTree.conditions, [{ course: 'CM999' }]);
eq('PREREQ از جدول دروس', r7.find(r => r.ruleType === 'PREREQ')!.logicTree.conditions, [{ course: 'CM101' }]);

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
