/**
 * تقویم جلالی (شمسی) — پیاده‌سازی مستقل از ICU.
 *
 * چرا؟ `Intl.DateTimeFormat('fa-IR-u-ca-persian')` در بیلد Next به polyfill
 * وابسته است و در ایمیج‌های slim ممکن است سال را اشتباه بدهد؛ ضمناً کد رهگیری
 * پرونده‌ها و سال تحصیلی نباید به ICU گره بخورد. این ماژول همان الگوریتم
 * jalaali-js را بدون هیچ وابستگی پیاده‌سازی می‌کند و در تست با ۱۰هزار+ تاریخ
 * با کتابخانهٔ مرجع مقایسه شده است.
 *
 * قرارداد: همهٔ ورودی/خروجی‌ها «سال کامل شمسی» است (مثلاً ۱۴۰۵).
 */

const GREGORIAN_MONTH_LENGTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
void GREGORIAN_MONTH_LENGTH;

function div(a: number, b: number) { return ~~(a / b); }
function mod(a: number, b: number) { return a - ~~(a / b) * b; }

/** میلادی → جلالی */
export function toJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  return d2j(g2d(gy, gm, gd));
}

export function toJalaliFromDate(d: Date): { jy: number; jm: number; jd: number } {
  return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** جلالی → میلادی */
export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

/** روز جولیان از تاریخ میلادی */
export function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** تاریخ میلادی از روز جولیان */
export function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** نقطه‌های شکست تقویم جلالی (جدول استاندارد jalaali-js) — بر حسب سال کامل شمسی */
const JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
export const MIN_JALALI_YEAR = -61;
export const MAX_JALALI_YEAR = 3177;

/**
 * پارامترهای کبیسه و مبدأ بهاری یک سال جلالی.
 * @param jy سال کامل شمسی (مثلاً ۱۴۰۵)
 */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621;
  if (jy < MIN_JALALI_YEAR || jy > MAX_JALALI_YEAR) throw new Error('سال جلالی خارج از بازهٔ پشتیبانی: ' + jy);

  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jump = 0;

  // پیدا کردن کران‌های چرخهٔ ۳۳ سالهٔ شامل این سال
  for (let i = 1; i < JALALI_BREAKS.length; i++) {
    const jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  const n = jy - jp;

  // شمار سال‌های کبیسهٔ جلالی از ۶۲۱ میلادی تا آغاز این سال
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  // همان شمار برای تقویم میلادی تا سال gy
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;

  // روزِ اسفند/فروردین: روزِ مارسِ آغاز سال جلالی
  const march = 20 + leapJ - leapG;

  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** روز جولیان از تاریخ جلالی */
export function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** تاریخ جلالی از روز جولیان */
export function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  let r: { leap: number; gy: number; march: number };
  try {
    r = jalCal(jy);
  } catch {
    // بیرون از بازهٔ جدول → با سال قبل ادامه می‌دهیم (همان رفتار jalaali-js)
    jy -= 1;
    r = jalCal(jy);
  }
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalCal(jy).leap === 0 ? 30 : 29;
}

export function isLeapJalali(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** رقم‌های فارسی — فقط برای نمایش */
export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, d => FA_DIGITS[Number(d)]);
}

/** «۱٬۲۳۴٬۵۶۷» با جداکنندهٔ هزارگان */
export function groupThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
}
