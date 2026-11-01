/**
 * نگاشت «نوع درس بانک» → «نقش کاتالوگ» — تنها منبع حقیقت (کلاینت + سرور).
 *
 * مشکل: ستون courses.courseType مقدار خام سیستم قدیم است (ستون ۷ اکسل سماء،
 * حداکثر ۵۰ حرف، بدون هنجارسازی): «عمومی/پایه/تخصصی/اصلی/اختیاری/جبرانی»،
 * گاهی «نظری/عملی»، گاهی کدهای انگلیسی مهاجرت (THEORY/PRACTICAL/GENERAL/PROJECT)،
 * گاهی NULL یا با املای عربی (ي/ك) و نیم‌فاصله‌های اضافه.
 *
 * راه‌حل: اول نرمال‌سازی (عربی→فارسی، حذف فاصله/نیم‌فاصله)، بعد نگاشت دقیق؛
 * هر چه شناخته نشد → 'CORE' (همان پیش‌فرض قدیمی فرم‌ها) تا هیچ‌وقت خطا ندهد.
 * نقش تکی هر ردیف همیشه در UI قابل تغییر است؛ این تابع فقط «پیش‌فرض اولیه» است.
 */

export function normalizeBankType(t: string | null | undefined): string {
  return (t ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[‌‍\s]+/g, '')
    .toUpperCase();
}

const BANK_TYPE_TO_ROLE: Record<string, string> = {
  // ── شش نوع سماء ──
  'عمومی': 'GENERAL',
  'پایه': 'CORE',
  'تخصصی': 'SPECIALIZED',
  'اصلی': 'MAJOR',
  'اختیاری': 'ELECTIVE',
  'جبرانی': 'COMPENSATORY',
  // ── کدهای انگلیسی مهاجرت (tuition codemap) ──
  'GENERAL': 'GENERAL',
  'PROJECT': 'THESIS',
  // ── نقش‌های مستقیم (اگر بانک همان نقش را داشت) ──
  'CORE': 'CORE',
  'MAJOR': 'MAJOR',
  'SPECIALIZED': 'SPECIALIZED',
  'ELECTIVE': 'ELECTIVE',
  'THESIS': 'THESIS',
  'INTERNSHIP': 'INTERNSHIP',
  'WORKSHOP': 'WORKSHOP',
  'پایاننامه': 'THESIS',
  'پروژه': 'THESIS',
  'کارآموزی': 'INTERNSHIP',
  'کارگاه': 'WORKSHOP',
  // ── حالت‌های فاصله‌دار/کشیده که بعد از نرمال‌سازی می‌چسبند ──
  'درسعمومی': 'GENERAL',
  'درسپایه': 'CORE',
  'درستخصصی': 'SPECIALIZED',
  'درساصلی': 'MAJOR',
  'درساختیاری': 'ELECTIVE',
};

/** پیش‌فرض نقش کاتالوگ از روی نوع بانک؛ ناشناخته/خالی → 'CORE'. */
export function roleFromBankType(t: string | null | undefined): string {
  return BANK_TYPE_TO_ROLE[normalizeBankType(t)] ?? 'CORE';
}
