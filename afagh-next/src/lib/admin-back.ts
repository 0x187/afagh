/**
 * محاسبهٔ هدفِ «بازگشت به کارتابل» در شاخهٔ مدیریت — منطق خالص و تست‌پذیر.
 *
 * مسئله: کارتابل‌های کارشناسی خودشان زیرصفحه دارند (`/admin/finance/pos`،
 * `/admin/exams/handover`، `/admin/scheduling/…`). یک دکمهٔ ثابتِ «بازگشت به
 * `/admin`» کارشناس را از کارتابل خودش بیرون می‌انداخت. هدف درست،
 * **عمیق‌ترین ماژولِ ثبت‌شده‌ای است که پیشوندِ مسیر جاری و کوتاه‌تر از آن باشد**.
 *
 * نمونه‌ها (با ماژول‌های `/admin` و `/admin/finance`):
 *   `/admin`               → null (روی داشبورد، دکمه لازم نیست)
 *   `/admin/finance`       → `/admin`            (کارتابل مالی = سطح اول)
 *   `/admin/finance/pos`   → `/admin/finance`    (زیرصفحهٔ مالی)
 *   `/admin/c/14`          → `/admin`            (مسیر بدون ماژول ثبت‌شده)
 */

export interface BackTarget {
  href: string;
  title: string;
  /** هدف همان داشبورد کل است؟ (برای برچسب و نمایش میان‌بر) */
  isHome: boolean;
}

const stripTrailing = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export function resolveBackTarget(
  rawPathname: string | null | undefined,
  modules: readonly { href: string; title: string }[],
  homeHref = '/admin',
  homeLabel = 'داشبورد مدیریت',
): BackTarget | null {
  const pathname = stripTrailing(String(rawPathname ?? '').trim());
  if (!pathname || pathname === homeHref) return null;

  const isUnder = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // عمیق‌ترین ماژولی که «بالاتر» از صفحهٔ جاری است (خودِ مسیر جاری حساب نیست)
  const parent = modules
    .filter((m) => m.href !== pathname && m.href.length < pathname.length && isUnder(m.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  // `/admin` خودش هم ماژول ثبت‌شده است (کارتابل گردش کار)؛ وقتی هدف همان
  // داشبورد است برچسبِ ماژول را نشان نده — «داشبورد مدیریت» درست است.
  const href = parent && parent.href !== homeHref ? parent.href : homeHref;
  const title = parent && parent.href !== homeHref ? parent.title : homeLabel;
  return { href, title, isHome: href === homeHref };
}
