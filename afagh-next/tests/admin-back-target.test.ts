/**
 * تست واحد «هدفِ بازگشت به کارتابل» — `src/lib/admin-back.ts`
 *
 * اجرا: npm test  (بخش admin-back)
 *
 * زمینه: کارتابل‌های کارشناسی زیرصفحه دارند (`/admin/finance/pos`). یک دکمهٔ
 * ثابتِ «بازگشت به /admin» کارشناس را از کارتابل خودش بیرون می‌انداخت؛ کاربر
 * گزارش داد «در اکثر کارتابل‌های کارشناسان اعمال نشده». هدفِ درست، عمیق‌ترین
 * ماژولِ ثبت‌شده‌ای است که پیشوندِ مسیر جاری و کوتاه‌تر از آن باشد.
 */
import { resolveBackTarget } from '../src/lib/admin-back.ts';

let pass = 0;
let fail = 0;
function t(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}

// ماژول‌ها همان‌طور که از ADMIN_MODULES می‌آیند (نمونهٔ واقعی)
const MODULES = [
  { href: '/admin', title: 'کارتابل گردش کار و جبرانی' },
  { href: '/admin/finance', title: 'کارتابل مالی' },
  { href: '/admin/finance/pos', title: 'صندوق (POS)' },
  { href: '/admin/exams', title: 'برنامه‌ریزی امتحانات' },
  { href: '/admin/settings', title: 'پیکربندی سامانه' },
  { href: '/admin/reports', title: 'مرکز گزارش‌ها' },
];

const at = (p: string) => resolveBackTarget(p, MODULES);

console.log('— روی داشبورد کل: دکمه‌ای رندر نمی‌شود —');
t('/admin → null', at('/admin') === null);
t('/admin/ (اسلش پایانی) → null', at('/admin/') === null);
t('مسیر خالی → null', at('') === null);

console.log('— سطح اول کارتابل: بازگشت به داشبورد —');
t('/admin/finance → /admin', at('/admin/finance')?.href === '/admin');
t('برچسب داشبورد مدیریت است (نه عنوان ماژول /admin)',
  at('/admin/finance')?.title === 'داشبورد مدیریت');
t('isHome درست است', at('/admin/finance')?.isHome === true);
t('/admin/settings → /admin', at('/admin/settings')?.href === '/admin');
t('/admin/reports → /admin', at('/admin/reports')?.href === '/admin');

console.log('— زیرصفحهٔ کارتابل: بازگشت به همان کارتابل (باگ گزارش‌شده) —');
t('/admin/finance/pos → /admin/finance', at('/admin/finance/pos')?.href === '/admin/finance');
t('عنوان همان کارتابل مالی است', at('/admin/finance/pos')?.title === 'کارتابل مالی');
t('isHome=false تا میان‌بر داشبورد هم بیاید', at('/admin/finance/pos')?.isHome === false);
t('/admin/finance/pos/today → /admin/finance/pos (نزدیک‌ترین کارتابال، نه دو سطح بالاتر)',
  at('/admin/finance/pos/today')?.href === '/admin/finance/pos');
t('/admin/exams/handover → /admin/exams', at('/admin/exams/handover')?.href === '/admin/exams');
t('/admin/finance/pos/ (اسلش پایانی) → /admin/finance', at('/admin/finance/pos/')?.href === '/admin/finance');

console.log('— مسیر بدون ماژول ثبت‌شده: بازگشت به داشبورد —');
t('/admin/c/14 → /admin', at('/admin/c/14')?.href === '/admin');
t('/admin/xyzzy/foo → /admin', at('/admin/xyzzy/foo')?.href === '/admin');

console.log('— تله‌ها: پیشوندِ شبیهِ ولی نادرست —');
t('/admin/financial (نه finance) → /admin', at('/admin/financial')?.href === '/admin');
t('/admin/exams-archive → /admin', at('/admin/exams-archive')?.href === '/admin');

console.log('— پارامترهای دلخواه —');
const custom = resolveBackTarget('/x/y/z', [{ href: '/x', title: 'خانه' }, { href: '/x/y', title: 'کارتابل وای' }], '/x', 'خانه');
t('homeHref سفارشی', custom?.href === '/x/y');
t('عنوان کارتابال سفارشی', custom?.title === 'کارتابل وای');
t('روی homeHref سفارشی → null', resolveBackTarget('/x', [{ href: '/x', title: 'خانه' }], '/x') === null);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} موفق، ${fail} ناموفق`);
if (fail > 0) process.exit(1);
