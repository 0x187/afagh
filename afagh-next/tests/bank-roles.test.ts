/**
 * تست نگاشت «نوع درس بانک» → «نقش کاتالوگ» (src/lib/bank-roles.ts).
 * بانک مقدار خام سیستم قدیم را دارد؛ نگاشت باید املاهای عربی/فاصله‌دار و
 * کدهای انگلیسی مهاجرت را هم پوشش دهد و هرگز خطا ندهد (ناشناخته → CORE).
 */
import { normalizeBankType, roleFromBankType } from '../src/lib/bank-roles';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

console.log('\n— شش نوع سماء —');
ok(roleFromBankType('عمومی') === 'GENERAL', 'عمومی → GENERAL');
ok(roleFromBankType('پایه') === 'CORE', 'پایه → CORE');
// از کامیت f83f070 به بعد «تخصصی» از «اصلی» جدا شده و نقش مستقل SPECIALIZED می‌گیرد.
ok(roleFromBankType('تخصصی') === 'SPECIALIZED', 'تخصصی → SPECIALIZED');
ok(roleFromBankType('اصلی') === 'MAJOR', 'اصلی → MAJOR');
ok(roleFromBankType('اختیاری') === 'ELECTIVE', 'اختیاری → ELECTIVE');
// از مهاجرت ۰۱۲۹ (کامیت 6c77fad) «جبرانی» نقش مستقل COMPENSATORY گرفت و
// دیگر به ELECTIVE نگاشت نمی‌شود.
ok(roleFromBankType('جبرانی') === 'COMPENSATORY', 'جبرانی → COMPENSATORY');

console.log('\n— کدهای انگلیسی مهاجرت و نقش‌های مستقیم —');
ok(roleFromBankType('GENERAL') === 'GENERAL', 'GENERAL → GENERAL');
ok(roleFromBankType('general') === 'GENERAL', 'حروف کوچک هم قبول');
ok(roleFromBankType('PROJECT') === 'THESIS', 'PROJECT → THESIS');
ok(roleFromBankType('پایان‌نامه') === 'THESIS', 'پایان‌نامه → THESIS');
ok(roleFromBankType('کارآموزی') === 'INTERNSHIP', 'کارآموزی → INTERNSHIP');
ok(roleFromBankType('کارگاه') === 'WORKSHOP', 'کارگاه → WORKSHOP');

console.log('\n— نرمال‌سازی املا —');
ok(normalizeBankType('پايه') === 'پایه', 'ي عربی → ی');
ok(normalizeBankType('تخصصي') === 'تخصصی', 'ي پایانی → ی');
ok(normalizeBankType('  عمومی  ') === 'عمومی', 'فاصله‌های اضافه حذف');
ok(normalizeBankType('درس عمومی') === 'درسعمومی', 'نیم‌فاصله/فاصله حذف');
ok(roleFromBankType('پايه') === 'CORE', 'پايه (عربی) → CORE');
ok(roleFromBankType('درس تخصصی') === 'SPECIALIZED', '«درس تخصصی» فاصله‌دار → SPECIALIZED');

console.log('\n— ناشناخته/خالی → CORE بدون خطا —');
ok(roleFromBankType(null) === 'CORE', 'null → CORE');
ok(roleFromBankType('') === 'CORE', 'رشته خالی → CORE');
ok(roleFromBankType('؟') === 'CORE', 'مقدار نامشخص بانک → CORE');
ok(roleFromBankType('نظری') === 'CORE', 'نظری (حالت ارائه، نه نقش) → CORE');
ok(roleFromBankType('عملی') === 'CORE', 'عملی (حالت ارائه، نه نقش) → CORE');
ok(roleFromBankType('چیز عجیب') === 'CORE', 'مقدار ناشناخته → CORE');

if (fail) { console.log(`\n✗ ${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\n✓ همه (${pass}) گذشت`);
