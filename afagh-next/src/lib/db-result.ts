/**
 * نرمال‌سازی خروجی `db.execute(...)`.
 *
 * چرا: Drizzle روی node-postgres آبجکت `Result` برمی‌گرداند (`{ rows, rowCount }`)
 * ولی روی بعضی درایورها/نسخه‌ها آرایهٔ ساده. به همین دلیل در چند فایل الگوی
 * `(res as any).rows ?? res` تکرار شده بود — یعنی هم `as any` و هم ریسکِ
 * رفتار متفاوت بین درایورها. این ماژول همان تصمیم را یک‌جا و تایپ‌شده می‌گیرد.
 */

/** ردیف‌های یک نتیجه — هم شکل `{ rows }` و هم آرایهٔ خام را می‌پذیرد. */
export function execRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const rows = (res as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** تعداد ردیف‌های تأثیرگرفته (برای UPDATE/DELETE/INSERT خام). */
export function execRowCount(res: unknown): number {
  return Number((res as { rowCount?: number } | null | undefined)?.rowCount ?? 0);
}

/** نخستین ردیف یا `undefined`. */
export function execFirstRow<T>(res: unknown): T | undefined {
  return execRows<T>(res)[0];
}
