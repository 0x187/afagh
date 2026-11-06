/**
 * ═══════════════════════════════════════════════════════════════════════
 *  الگوی مشترکِ «فهرستِ سقف‌دار با جست‌وجوی سروری»
 *
 *  چرا این ماژول؟
 *    چند صفحهٔ کارتابل فهرست‌هایی را می‌خواندند که *بی‌سقف* بودند و همهٔ
 *    ردیف‌ها را در RSC به کلاینت می‌فرستادند. روی خط کم‌سرعت (≈۳۰KB/s) هر
 *    ۱۰۰KB اضافه یعنی چند ثانیه انتظارِ بی‌مورد. الگوی درست:
 *
 *      ۱) سرور فیلتر می‌کند (نرمال‌سازی فارسی، تا «ي» با «ی» بخورد)،
 *      ۲) سرور سقف می‌گذارد (۱۰۰ ردیف)،
 *      ۳) کلاینت برای بقیه جست‌وجو می‌کند.
 *
 *  همهٔ صفحه‌ها از همین دو تابع استفاده می‌کنند تا رفتارشان یکدست بماند.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { sql, type SQL } from 'drizzle-orm';
import { faLikePattern, normCol } from './persian-search';

/** سقف پیش‌فرض ردیف‌های برگشتی. */
export const LIST_CAP_DEFAULT = 100;
/** سقف مطلق — هیچ فهرستی از این بیشترتر برنمی‌گردد. */
export const LIST_CAP_MAX = 500;

/**
 * شرط‌های ILIKE نرمال‌شدهٔ فارسی روی چند ستون (بینشان OR).
 *
 *  @param q    عبارت خام کاربر
 *  @param cols ستون‌های متنی (یا عبارت SQL) که باید در آن‌ها جست‌وجو شود
 *  @returns آرایهٔ شرط‌ها — اگر `q` خالی باشد آرایه خالی است
 *
 *  نمونه:
 *    const c = faSearchConds(q, [courses.code, courses.title]);
 *    db.select().from(courses).where(and(eq(courses.departmentId, id), or(...c)))
 */
export function faSearchConds(q: string | null | undefined, cols: unknown[]): SQL[] {
  const query = (q ?? '').trim();
  if (!query || cols.length === 0) return [];
  const pat = faLikePattern(query);
  return cols.map(c => sql`${normCol(c)} ILIKE ${pat} ESCAPE '\\'`);
}

/**
 * سقف امنِ ردیف‌ها — ورودیِ کاربر/URL هرگز نمی‌تواند از سقف مطلق بگذرد.
 * (جلوگیری از «?limit=100000» که کل جدول را می‌کشد.)
 */
export function capRows(n: number | null | undefined, def = LIST_CAP_DEFAULT, max = LIST_CAP_MAX): number {
  const v = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : def;
  return Math.min(Math.max(v, 1), max);
}
