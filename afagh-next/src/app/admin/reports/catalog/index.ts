/**
 * ══════════════════════════════════════════════════════════════════════
 *  رجیستری کاتالوگ گزارش — تنها منبعِ حقیقتِ «چه چیزهایی قابل گزارش است»
 * ══════════════════════════════════════════════════════════════════════
 *  افزودن یک منبعِ تازه = افزودن یک آرایه به همین فایل. هیچ‌جای دیگری
 *  نباید فهرست گزارش‌ها را تکرار کرد (همان اصلی که قبلاً در سه جا پخش بود
 *  و باعث ناهماهنگی می‌شد).
 */

import type { ReportSource, SourceMeta } from './types';
import { FINANCE_SOURCES } from './finance';

const ALL_SOURCES: ReportSource[] = [
  ...FINANCE_SOURCES,
];

const BY_KEY = new Map<string, ReportSource>(ALL_SOURCES.map(s => [s.key, s]));

/** همهٔ منابع (برای نمایش در گزارش‌ساز) */
export function listSources(): ReportSource[] {
  return ALL_SOURCES;
}

/** نسخهٔ سریال‌شدنیِ منابع — بدون عبارت‌های SQL، برای ارسال به کلاینت */
export function listSourceMetas(): SourceMeta[] {
  return ALL_SOURCES.map(s => ({
    key: s.key,
    title: s.title,
    icon: s.icon,
    description: s.description,
    fields: s.fields.map(f => ({
      key: f.key,
      title: f.title,
      type: f.type,
      format: f.format,
      filterable: f.filterable,
      ops: f.ops,
      groupable: f.groupable,
      agg: f.agg,
      options: f.options,
      ref: f.ref,
      hint: f.hint,
    })),
  }));
}

/** یک منبع با کلیدش — اگر نبود، null (موتور اجرا fail-closed برخورد می‌کند) */
export function getSource(key: string): ReportSource | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * فیلدِ یک منبع با کلیدش — اگر نبود، null.
 * 🔒 موتور اجرا فقط از همین راه فیلدها را پیدا می‌کند؛ پس هیچ کلیدِ
 * ناشناخته‌ای هرگز به SQL راه پیدا نمی‌کند.
 */
export function getField(source: ReportSource, fieldKey: string) {
  return source.fields.find(f => f.key === fieldKey) ?? null;
}

export * from './types';
export { FINANCE_SOURCES, LEDGER_TYPES, DEPOSIT_TYPES, PAYMENT_STATUSES } from './finance';
