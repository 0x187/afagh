/**
 * نرمال‌سازیِ کلیدهای تطبیقِ سما ↔ آفاق.
 *
 * ⚠ چرا این فایل جدا و «خالص» است: هر بار که همگام‌سازی دستی انجام شد،
 * اختلاف‌های الکی از همین‌جا می‌آمد — ارقامِ فارسی در یک ستون، صفرِ پیشرو در
 * ستونِ دیگر، و کد درسی که سما با ۵ رقم و آفاق با ۷ رقم نگه می‌دارد. اگر
 * نرمال‌سازی داخلِ کوئری باشد، هیچ‌جا قابل تست نیست و دوباره تکرار می‌شود.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی → ASCII، حذفِ نویسه‌های کنترلی و فاصله‌های اضافی. */
export function normalizeDigits(input: unknown): string {
  let s = String(input ?? '');
  if (!s) return '';
  s = s.replace(/[\u06F0-\u06F9]/g, (c) => String(FA_DIGITS.indexOf(c)))
       .replace(/[\u0660-\u0669]/g, (c) => String(AR_DIGITS.indexOf(c)))
       .replace(/\u200c/g, ' ')
       .replace(/\u00a0/g, ' ');
  return s.trim();
}

/** فقط ارقام؛ برای کلیدهای عددی. */
export function digitsOnly(input: unknown): string {
  return normalizeDigits(input).replace(/\D+/g, '');
}

/**
 * کلید کد دانشجو.
 *
 * صفرِ پیشرو در سما معنادار نیست (کد ۸ رقمی در یک گزارش، ۹ رقمی در گزارش
 * دیگر) و اگر حذف نشود، هر ردیف «دانشجوی گم‌شده» می‌شود. ارقام فارسی هم که
 * در فایل‌های دست‌سازِ کارشناسان زیاد دیده می‌شود.
 */
export function studentKey(input: unknown): string {
  const d = digitsOnly(input);
  return d.replace(/^0+/, '');
}

/** کلید کد درس — همان منطق؛ کد درسِ سما ۵ رقمی و آفاق گاهی ۷ رقمی است. */
export function courseKey(input: unknown): string {
  const d = digitsOnly(input);
  return d.replace(/^0+/, '');
}

/** شمارهٔ گروه: هر چیزِ نامعتبر ⇒ null (نه صفر؛ صفر یعنی «گروه ۰» که وجود ندارد). */
export function groupNumber(input: unknown): number | null {
  const d = digitsOnly(input);
  if (!d) return null;
  const n = Number(d);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** کلید ترم — چهار رقمِ سال + رقمِ نیمسال، مثل ۱۴۰۵۱ → 14051. */
export function termKey(input: unknown): string {
  return digitsOnly(input);
}

/** نمرهٔ سما: «۲۰»، «19.5»، «۱۹٫۵» → عدد؛ خالی/نامعتبر ⇒ null. */
export function parseGrade(input: unknown): number | null {
  const raw = normalizeDigits(input).replace(/[٫،]/g, '.').replace(/[^\d.]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // نمرهٔ خارج از بازهٔ ۰–۲۰ در سما معنا ندارد (۲۰۰ = «۲۰٫۰» با صفرِ اضافه)
  if (n > 20) {
    const scaled = n / 10;
    return scaled <= 20 ? Math.round(scaled * 100) / 100 : null;
  }
  return Math.round(n * 100) / 100;
}

/** کلید یکتای «ارائه» در آفاق: ترم + درس + گروه. */
export function offeringKey(termCode: unknown, courseCode: unknown, group: unknown): string {
  return `${termKey(termCode)}|${courseKey(courseCode)}|${groupNumber(group) ?? ''}`;
}

/** کلید یکتای یک ردیف انتخاب واحد در سما (دانشجو + ارائه). */
export function enrollKey(studentCode: unknown, termCode: unknown, courseCode: unknown, group: unknown): string {
  return `${studentKey(studentCode)}|${termKey(termCode)}|${courseKey(courseCode)}|${groupNumber(group) ?? ''}`;
}

/** کلید «دانشجو + درس» بدون گروه — برای تشخیص GROUP_MISMATCH. */
export function studentCourseKey(studentCode: unknown, termCode: unknown, courseCode: unknown): string {
  return `${studentKey(studentCode)}|${termKey(termCode)}|${courseKey(courseCode)}`;
}
