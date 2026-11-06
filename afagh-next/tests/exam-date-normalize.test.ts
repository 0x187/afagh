/**
 * تست واحد نرمال‌سازی «تاریخ تقویم امتحان» — `src/lib/shamsi.ts`
 *
 * اجرا: npm test  (بخش exam-date)
 *
 * زمینه: `schedules.examDate` یکدست نوشته نمی‌شود — مسیر رزرو شیفت میلادی
 * می‌نویسد، ولی ردیف‌های ایمپورت/سید قدیمی و سما شمسی (`1405-10-28`). پیش‌تر
 * خواننده همه را میلادی فرض می‌کرد و تاریخ‌های شمسی دوباره تبدیل می‌شدند:
 * ۱۴۰۵-۱۰-۲۸ → ۷۸۴/۰۸/۰۶ (باگ «تاریخ‌های نامعتبر» در رادار ظرفیت امتحان).
 *
 * ⚠ در تست‌ها هرگز `toISOString()` برای مقایسهٔ روز استفاده نشده — آن تابع
 * تاریخ محلی را به UTC می‌برد و در تهران (UTC+3:30) یک روز عقب می‌افتد.
 */
import { examDateColumnValue, examDateToGregorian, normalizeExamDate } from '../src/lib/shamsi.ts';

let pass = 0;
let fail = 0;
function t(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

console.log('— تاریخ امتحان: ورودی شمسی دست‌نخورده می‌ماند —');
t('۱۴۰۵-۱۰-۲۸ (خط تیره) → 1405/10/28', normalizeExamDate('1405-10-28') === '1405/10/28');
t('۱۴۰۵/۱۰/۲۷ (اسلش) → 1405/10/27', normalizeExamDate('1405/10/27') === '1405/10/27');
t('ماه/روز یک‌رقمی صفر می‌گیرد', normalizeExamDate('1405-1-5') === '1405/01/05');
t('سال ۱۴۰۵ تبدیل نمی‌شود (باگ قبلی → ۷۸۴/۰۸/۰۶)', normalizeExamDate('1405-10-28')?.startsWith('1405/') === true);

console.log('— تاریخ امتحان: ورودی میلادی تبدیل می‌شود —');
t('2027-01-18 → 1405/10/28', normalizeExamDate('2027-01-18') === '1405/10/28');
t('2027-01-17 → 1405/10/27', normalizeExamDate('2027-01-17') === '1405/10/27');
t('2026-03-21 → 1405/01/01 (نوروز)', normalizeExamDate('2026-03-21') === '1405/01/01');
t('شیء Date پذیرفته می‌شود', normalizeExamDate(new Date(2027, 0, 18)) === '1405/10/28');
t('ISO با زمان پذیرفته می‌شود', normalizeExamDate('2027-01-18T00:00:00.000Z') === '1405/10/28');

console.log('— لبه‌ها —');
t('خالی → null', normalizeExamDate('') === null);
t('null → null', normalizeExamDate(null) === null);
t('undefined → null', normalizeExamDate(undefined) === null);
t('متن نامعتبر → null', normalizeExamDate('bad') === null);
t('Date نامعتبر → null', normalizeExamDate(new Date('x')) === null);

console.log('— رفت‌وبرگشت شمسی → میلادی → شمسی —');
for (const j of ['1405/10/28', '1405/11/14', '1405/01/01', '1405/12/29', '1403/12/30']) {
  const g = examDateToGregorian(j);
  t(`${j} → ${ymd(g)} → همان تاریخ`, normalizeExamDate(g) === j);
}
t('۱۴۰۵/۱۰/۲۸ = 2027-01-18', ymd(examDateToGregorian('1405/10/28')) === '2027-01-18');
t('۱۴۰۵/۰۱/۰۱ = 2026-03-21', ymd(examDateToGregorian('1405/01/01')) === '2026-03-21');

console.log("— مقدارِ نوشتن در ستون date: همیشه شمسی 'YYYY-MM-DD' —");
// قرارداد: `schedules.examDate` برچسبِ شمسی نگه می‌دارد (مثل ۱۲۹۵ ردیف موجود).
// هر مسیر نوشتن باید از این تابع رد شود تا ستون دوباره دوقالبه نشود.
t('شمسی اسلش → شمسی خط‌تیره', examDateColumnValue('1405/10/22') === '1405-10-22');
t('شمسی خط‌تیره دست‌نخورده', examDateColumnValue('1405-10-22') === '1405-10-22');
t('میلادی → شمسی (نه میلادی)', examDateColumnValue('2027-01-12') === '1405-10-22');
t('Date میلادی → شمسی', examDateColumnValue(new Date(2027, 0, 12)) === '1405-10-22');
t('چهاررقمی یک‌رقمی صفر می‌گیرد', examDateColumnValue('1405/1/5') === '1405-01-05');
t('خالی → null', examDateColumnValue('') === null);
t('null → null', examDateColumnValue(null) === null);
t('نامعتبر → null', examDateColumnValue('bad') === null);
t('هیچ‌گاه سالِ میلادی برنمی‌گرداند',
  !String(examDateColumnValue('2027-01-12')).startsWith('2027'));

console.log('');
if (fail > 0) { console.error(`❌ ${fail} ناموفق از ${pass + fail}`); process.exit(1); }
console.log(`✅ ${pass} موفق، 0 ناموفق`);
