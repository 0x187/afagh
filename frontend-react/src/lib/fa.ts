// ═══ ارقام فارسی — پورت مینیمال از afagh-next/src/lib/persian-search.ts ═══
// (نسخهٔ کامل با نرمال‌سازی حروف در فاز ۲ پورت می‌شود؛ اینجا فقط ارقام
//  که برای نمایش و ورود کدها لازم است.)

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** تبدیل ارقام لاتین به فارسی — برای نمایش */
export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** تبدیل ارقام فارسی/عربی به لاتین — برای ورودی‌ها (همان toEnDigits) */
export function toEnDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** عدد با جداکنندهٔ هزارگان + ارقام فارسی */
export function faNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return faDigits(Math.round(value).toLocaleString('en-US'));
}

/** مبلغ ریالی خوانا: «۳٬۰۰۰٬۰۰۰ ریال» */
export function faRial(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${faNumber(value)} ریال`;
}
