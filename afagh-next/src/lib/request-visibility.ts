/**
 * visibility فرآیندهای میزخدمات (BPM) بر اساس مقطع دانشجو.
 *
 * دانشجویان کاردانی/کارشناسی نباید درخواست‌های مربوط به پایان‌نامه
 * (پروپوزال/دفاع/رساله) را ببینند — این فرآیندها فقط برای تحصیلات تکمیلی
 * (کارشناسی ارشد/دکتری) معنا دارند. خالص و بدون وابستگی به DB تا در تست‌ها
 * و هم در صفحهٔ فهرست درخواست‌ها و هم در گارد ثبت درخواست استفاده شود.
 */

import { faIncludes } from './persian-search';

/** کدهای مقاطع غیر تحصیلات تکمیلی (کاردانی/کارشناسی) — عین seed: AD/AS/BS/BA */
const NON_GRAD_DEGREE_CODES = new Set(['AD', 'AS', 'BS', 'BA']);

export type DegreeLevelLike = {
  code?: string | null;
  title?: string | null;
  /** ستون isGraduate در degree_level_configs — ۱ = ارشد/دکتری، ۰ = کاردانی/کارشناسی، NULL = مشخص نیست */
  isGraduate?: number | null;
} | null | undefined;

/**
 * آیا مقطع، تحصیلات تکمیلی است؟
 * ترتیب تصمیم: فلگ صریح isGraduate → کد مقطع → عنوان فارسی → پیش‌فرض «خیر»
 * (اگر مقطع قابل تشخیص نباشد، پایان‌نامه نشان داده نمی‌شود — محافظه‌کارانه).
 */
export function isGraduateDegreeLevel(level: DegreeLevelLike): boolean {
  const flag = level?.isGraduate;
  if (flag === 1) return true;
  if (flag === 0) return false;

  const code = String(level?.code ?? '').trim().toUpperCase();
  if (code) {
    if (NON_GRAD_DEGREE_CODES.has(code)) return false;
    // MS/MA/MSC/MBA/MENG و PHD/DBA/DVM/DOC — کد «دیپلم» (D…) عمداً ارشد فرض نمی‌شود
    if (/^M/.test(code) || /^PHD/.test(code)) return true;
    if (['DBA', 'DVM', 'DOC'].includes(code)) return true;
  }

  const title = String(level?.title ?? '');
  if (title) {
    if (
      faIncludes(title, 'ارشد') ||
      faIncludes(title, 'دکتری') ||
      faIncludes(title, 'دکترا') ||
      faIncludes(title, 'رساله')
    ) {
      return true;
    }
    if (faIncludes(title, 'کاردانی') || faIncludes(title, 'کارشناسی')) return false;
  }
  return false;
}

export type ProcessLike = {
  code?: string | null;
  title?: string | null;
  description?: string | null;
} | null | undefined;

/**
 * آیا فرآیند BPM مربوط به پایان‌نامه است؟
 * کد THESIS* + تطبیق متن عنوان/توصیف (نرمال فارسی: نیم‌فاصله/فاصله/ی/ک عربی)
 * تا فرآیندهای ساخته‌شده در ادمین با کد دلخواه هم در فیلتر بیفتند.
 */
export function isThesisProcess(p: ProcessLike): boolean {
  const code = String(p?.code ?? '').trim().toUpperCase();
  if (code.startsWith('THESIS')) return true;

  const text = `${p?.title ?? ''} ${p?.description ?? ''}`;
  return (
    faIncludes(text, 'پایان نامه') ||
    faIncludes(text, 'پایاننامه') ||
    faIncludes(text, 'پروپوزال') ||
    faIncludes(text, 'رساله') ||
    faIncludes(text, 'دفاع')
  );
}
