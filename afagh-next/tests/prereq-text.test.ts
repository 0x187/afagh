/**
 * تست واحد تجزیهٔ متن «پیش‌نیاز / هم‌نیاز / هم‌ارز» — بدون DB.
 *
 * چرا: در سیستم قدیمی این سه قاعده داخل «جدول دروس» بودند و در مهاجرت
 * نادیده گرفته شدند (course_rules خالی ماند و هشدار پیش‌نیاز هرگز نمایش
 * داده نشد). این تست قرارداد parser را قفل می‌کند تا متن‌های واقعیِ
 * سلول‌های اکسل (فارسی، ویرگول فارسی، «یا»، «و»، برچسب، «ندارد»…) درست
 * به درخت منطقی course_rules تبدیل شوند.
 */
import {
  extractCourseCodes, hasAnyCourseCode, normalizeRequisiteText,
  parseEquivalentCodes, parseRequisiteText,
} from '../src/lib/prereq-text.ts';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      انتظار: ${JSON.stringify(want)}\n      دریافت: ${JSON.stringify(got)}`); }
}

console.log('— تجزیهٔ متن پیش‌نیاز / هم‌نیاز / هم‌ارز —');

console.log('\n۱) یکسان‌سازی متن');
eq('ارقام فارسی → لاتین', normalizeRequisiteText('۱۲۳۴'), '1234');
eq('ارقام عربی → لاتین', normalizeRequisiteText('٤٥٦'), '456');
eq('ي عربی → ی فارسی', normalizeRequisiteText('پيش‌نياز'), 'پیش نیاز');
eq('ك عربی → ک فارسی', normalizeRequisiteText('كمك'), 'کمک');
eq('فاصله‌های تکراری جمع می‌شوند', normalizeRequisiteText('  CM101   ،  CM102 '), 'CM101 ، CM102');
eq('null → رشتهٔ خالی', normalizeRequisiteText(null), '');

console.log('\n۲) استخراج کد درس');
eq('دو کد با ویرگول فارسی', extractCourseCodes('CM101، CM102'), ['CM101', 'CM102']);
eq('کد با حروف لاتین', extractCourseCodes('پیش‌نیاز: CM101'), ['CM101']);
eq('کد عددی فارسی', extractCourseCodes('۱۲۳۴'), ['1234']);
eq('تکرار حذف می‌شود', extractCourseCodes('CM101 و CM101'), ['CM101']);
eq('متن بدون کد', extractCourseCodes('ندارد'), []);
eq('یک رقم تنها کد نیست', extractCourseCodes('۳'), []);
eq('hasAnyCourseCode درست است', hasAnyCourseCode('CM101'), true);
eq('hasAnyCourseCode روی «ندارد»', hasAnyCourseCode('ندارد'), false);

console.log('\n۳) متن‌هایی که یعنی «قاعده‌ای نیست»');
for (const t of ['', '   ', '-', '—', 'ندارد', 'هیچ', '0']) {
  eq(`«${t}» → null`, parseRequisiteText(t), null);
}
eq('null → null', parseRequisiteText(null), null);

console.log('\n۴) پیش‌نیاز ساده');
eq('یک پیش‌نیاز', parseRequisiteText('CM101'),
  { operator: 'AND', conditions: [{ course: 'CM101' }] });
eq('برچسب «پیش‌نیاز:» حذف می‌شود', parseRequisiteText('پیش‌نیاز: CM101'),
  { operator: 'AND', conditions: [{ course: 'CM101' }] });
eq('برچسب «پیش نیاز -»', parseRequisiteText('پیش نیاز - CM101'),
  { operator: 'AND', conditions: [{ course: 'CM101' }] });
eq('برچسب انگلیسی', parseRequisiteText('Prerequisite: CM101'),
  { operator: 'AND', conditions: [{ course: 'CM101' }] });

console.log('\n۵) «و» یعنی AND (همه لازم‌اند)');
eq('دو پیش‌نیاز با ویرگول', parseRequisiteText('CM101، CM102'),
  { operator: 'AND', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('با «و»', parseRequisiteText('CM101 و CM102'),
  { operator: 'AND', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('با +', parseRequisiteText('CM101 + CM102'),
  { operator: 'AND', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('با ویرگول لاتین', parseRequisiteText('CM101, CM102'),
  { operator: 'AND', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('با لولهٔ سما → «یا» (دروس هم‌ارز)', parseRequisiteText('1100|27007'),
  { operator: 'OR', conditions: [{ course: '1100' }, { course: '27007' }] });
eq('سه کد با لوله → یا', parseRequisiteText('23105|23005|99108'),
  { operator: 'OR', conditions: [{ course: '23105' }, { course: '23005' }, { course: '99108' }] });
eq('پرانتز + & → (الف یا ب) و ج', parseRequisiteText('(27003|17003)&27002'),
  { operator: 'AND', conditions: [
    { operator: 'OR', conditions: [{ course: '27003' }, { course: '17003' }] },
    { course: '27002' },
  ] });
eq('& صریح → و', parseRequisiteText('CM101 & CM102'),
  { operator: 'AND', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });

console.log('\n۶) «یا» یعنی OR (یکی کافی است)');
eq('دو گزینه', parseRequisiteText('CM101 یا CM102'),
  { operator: 'OR', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('سه گزینه', parseRequisiteText('CM101 یا CM102 یا CM103'),
  { operator: 'OR', conditions: [{ course: 'CM101' }, { course: 'CM102' }, { course: 'CM103' }] });
eq('یا با برچسب', parseRequisiteText('پیش‌نیاز: CM101 یا CM102'),
  { operator: 'OR', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('or انگلیسی', parseRequisiteText('CM101 or CM102'),
  { operator: 'OR', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('|| یعنی یا', parseRequisiteText('CM101||CM102'),
  { operator: 'OR', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });
eq('| تک یعنی یا', parseRequisiteText('CM101|CM102'),
  { operator: 'OR', conditions: [{ course: 'CM101' }, { course: 'CM102' }] });

console.log('\n۷) هم‌نیاز (همان parser)');
eq('هم‌نیاز تک', parseRequisiteText('هم‌نیاز: CM102'),
  { operator: 'AND', conditions: [{ course: 'CM102' }] });
eq('هم‌نیاز فهرست کد (ستون coRequisites)', parseRequisiteText('CM102,CM103'),
  { operator: 'AND', conditions: [{ course: 'CM102' }, { course: 'CM103' }] });

console.log('\n۸) دروس هم‌ارز');
eq('دو معادل', parseEquivalentCodes('CM201، CM202'), ['CM201', 'CM202']);
eq('خودِ درس حذف می‌شود', parseEquivalentCodes('CM201، CM202', 'CM201'), ['CM202']);
eq('متن بدون کد', parseEquivalentCodes('ندارد'), []);
eq('حروف کوچک به بزرگ', parseEquivalentCodes('cm201'), ['CM201']);

console.log('\n۹) قرارداد JSON برای course_rules.logicTree');
const tree = parseRequisiteText('CM101 و CM102')!;
eq('قابل ذخیره در ستون text', JSON.stringify(tree),
  '{"operator":"AND","conditions":[{"course":"CM101"},{"course":"CM102"}]}');
eq('شرط‌ها فقط کلید course دارند', Object.keys((tree.conditions[0] as { course: string })), ['course']);

console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
process.exit(fail === 0 ? 0 : 1);
