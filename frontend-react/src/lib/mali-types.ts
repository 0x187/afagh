/**
 * «نوع درس مالی» سما (`LT7.Mali_type`) — همان کدی که نرخ هر واحد به آن گره خورده است.
 *
 * این جدول یک منبعِ واحد برای برچسب‌هاست: هم صفحهٔ «موتور شهریه» و هم صفحهٔ
 * «نوع درس مالی دروس» از همین‌جا می‌خوانند تا دو فهرست از هم جدا نشوند.
 *
 * ⚠️ کدها عیناً از سما آمده‌اند؛ ترتیب و شماره‌گذاری را عوض نکنید، چون
 * `tuition_term_tariff."maliType"` با همین اعداد کلید می‌خورد.
 */

export const MALI_TYPE_LABELS: Record<number, string> = {
  // صفر در سما یعنی «تعریف‌نشده»؛ در تعرفه هم ردیفی ندارد و شهریهٔ صفر می‌دهد.
  // عمداً در فهرست آمده تا اگر درسی روی صفر مانده، سلکت آن را نشان دهد نه خالی.
  0: 'بدون شهریه (نوع صفر)',
  1: 'عمومی',
  2: 'پایه',
  3: 'تخصصی',
  4: 'اصلی',
  5: 'نظری-عملی',
  6: 'پروژه',
  9: 'اردو',
  10: 'اختیاری',
  11: 'کارورزی',
  12: 'عمومی عملی',
  13: 'پیش‌دانشگاهی',
  14: 'نظری-عملی کارگاهی',
  15: 'نظری-عملی با پروژه',
  20: 'جبرانی',
  22: 'عملی آز/کارگاه ۲س',
  23: 'عملی آز/کارگاه ۳س',
};

/** همهٔ کدهای شناخته‌شده به ترتیب عددی — برای پُر کردن `<select>` */
export const MALI_TYPE_OPTIONS: { value: number; label: string }[] = Object.entries(MALI_TYPE_LABELS)
  .map(([k, label]) => ({ value: Number(k), label }))
  .sort((a, b) => a.value - b.value);

/** برچسب خوانا برای یک کد؛ کدِ ناشناخته را با شماره نشان می‌دهد */
export function maliTypeLabel(maliType: number | null | undefined): string {
  if (maliType == null) return 'تعیین‌نشده';
  const n = Number(maliType);
  return MALI_TYPE_LABELS[n] ?? `نوع ${n}`;
}

/**
 * آیا این نوع، در تعرفهٔ سما نرخ دارد؟ انواع «بی‌نرخ» عملاً شهریهٔ صفر تولید
 * می‌کنند و انتخابشان برای درسِ عادی اشتباه است.
 */
export const MALI_TYPE_NON_CHARGING = new Set([0, 5, 9, 12, 13, 15]);

/**
 * برچسبِ «نوع درس» برای ریز کارنامهٔ مالی.
 *
 * در کارنامه ستون «نرخ واحد» (عددی مشتق = مبلغ ÷ واحد) حذف شده و جایش همین
 * برچسب می‌نشیند، چون در سما نرخ از **نوع درس مالی** می‌آید و همین است که
 * مبلغ را توضیح می‌دهد. زنجیرهٔ پشتیبان:
 *
 *   maliType (دقیق، از تعرفه) → ماهیت درس (courses.courseNature) → سطلِ موتور
 *
 * هیچ‌کدام نبود «—»؛ در آن حالت درس در سما هم نوع ندارد و مبلغش صفر است.
 */
export function courseTypeLabelOf(src: {
  maliType?: number | null;
  courseNature?: string | null;
  offeringType?: string | null;
}): string {
  if (src.maliType != null) return maliTypeLabel(src.maliType);
  const nature = String(src.courseNature ?? '').trim();
  if (nature) return nature;
  const bucket = String(src.offeringType ?? '').trim();
  if (bucket) return bucket;
  return '—';
}
