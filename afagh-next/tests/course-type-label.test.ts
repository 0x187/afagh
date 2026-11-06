/**
 * تست برچسبِ «نوع درس» در ریز شهریهٔ متغیر کارنامه.
 *
 * زمینه: ستون «نرخ واحد» از کارنامه حذف شد چون عددی مشتق بود (مبلغ ÷ واحد) و
 * عرض کارت را می‌خورد؛ جایش «نوع درس» نشست که در سما نرخ را تعیین می‌کند.
 * این تست زنجیرهٔ پشتیبان را قفل می‌کند تا درسِ بی‌نوع بی‌صدا خالی نشود.
 */
import { courseTypeLabelOf, maliTypeLabel, MALI_TYPE_NON_CHARGING } from '../src/lib/mali-types';

let pass = 0;
let fail = 0;
function eq<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.error(`  ❌ ${label}\n     انتظار: ${JSON.stringify(expected)}\n     دریافت: ${JSON.stringify(actual)}`);
  }
}
const t = (label: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ✅ ${label}`);
  } catch (e) {
    fail++;
    console.error(`  ❌ ${label}: ${(e as Error).message}`);
  }
};

console.log('\n── برچسب نوع درس ──');

t('نوع مالی اولویت دارد', () => {
  // همان درس‌های واقعی کارنامه: ۵۱۰۰۸ پایه، ۹۹۰۰۲ عمومی، ۹۹۰۴۱ عملی آز/کارگاه ۲س
  eq(courseTypeLabelOf({ maliType: 2, courseNature: 'پايه' }), 'پایه', '۵۱۰۰۸');
  eq(courseTypeLabelOf({ maliType: 1, courseNature: 'عمومي' }), 'عمومی', '۹۹۰۰۲');
  eq(courseTypeLabelOf({ maliType: 4, courseNature: 'اصلي' }), 'اصلی', '۵۱۰۵۱');
  eq(courseTypeLabelOf({ maliType: 22, courseNature: 'نظري-عملي 2س' }), 'عملی آز/کارگاه ۲س', '۹۹۰۴۱');
});

t('نوع صفر هم چاپ می‌شود (یعنی بی‌نرخ، نه بی‌اطلاع)', () => {
  eq(courseTypeLabelOf({ maliType: 0 }), 'بدون شهریه (نوع صفر)', 'صفر');
  eq(MALI_TYPE_NON_CHARGING.has(0), true, 'در فهرست بی‌نرخ');
});

t('نبود نوع مالی → ماهیت درس', () => {
  eq(courseTypeLabelOf({ maliType: null, courseNature: 'تخصصي' }), 'تخصصي', 'ماهیت');
  eq(courseTypeLabelOf({ courseNature: 'پايان نامه' }), 'پايان نامه', 'ماهیت بدون کلید');
});

t('نبود ماهیت → سطل موتور', () => {
  eq(courseTypeLabelOf({ maliType: null, courseNature: '  ', offeringType: 'عملی' }), 'عملی', 'سطل');
});

t('هیچ‌کدام → خط تیره', () => {
  eq(courseTypeLabelOf({}), '—', 'خالی');
  eq(courseTypeLabelOf({ maliType: null, courseNature: null, offeringType: null }), '—', 'nullها');
});

t('کد ناشناخته با شماره نمایش داده می‌شود (نه خالی)', () => {
  eq(maliTypeLabel(99), 'نوع 99', 'کد ۹۹');
  eq(courseTypeLabelOf({ maliType: 99 }), 'نوع 99', 'زنجیره با کد ناشناخته');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} موفق، ${fail} ناموفق\n`);
if (fail > 0) process.exitCode = 1;
